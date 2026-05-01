import { appConfig } from '../../../core/config/app.config';
import { eventBus } from '../../../core/events/event-bus';
import { executeService } from '../../../infrastructure/ai/execute.service';
import {
  CorrelationMatch, CorrelationResult, cosine
} from '../domain/correlation.entity';
import { ProjectGoal, GoalCreateInput } from '../domain/project-goal.entity';
import { goalsRepository } from '../infrastructure/goals.repository';

export interface CorrelateInput {
  uid: string;
  sessionId?: string | null;
  actionRef: string;       // np. "intent:fragment:abc" / "quest:42" / "logos:analyze"
  actionText: string;
  topK?: number;
  minScore?: number;
  /** 'positive' (default) = quest.completed; 'negative' = quest.failed (anty-cel, score zapisywany ze znakiem -). */
  polarity?: 'positive' | 'negative';
}

/**
 * Tworzy nowy cel + wylicza embedding (mxbai-embed-large 1024D).
 * Embedding jest zapisywany asynchronicznie; jeśli provider zawiedzie, cel
 * zostaje bez wektora (uczestniczy w listach, ale nie w korelacji).
 */
export async function createGoalUseCase(input: GoalCreateInput): Promise<ProjectGoal> {
  const goal = await goalsRepository.create(input);
  const text = `${goal.title}\n${goal.description ?? ''}`.trim();
  embedAndPersist(goal.goalId, text).catch(err => {
    // eslint-disable-next-line no-console
    console.warn('[resolver] goal embedding failed:', (err as Error).message);
  });
  eventBus.publish('resolver.goal.created', {
    goalId: goal.goalId, uid: goal.uid, title: goal.title
  }, goal.sessionId ?? undefined);
  return goal;
}

async function embedAndPersist(goalId: string, text: string): Promise<void> {
  if (!text) return;
  const out = await executeService.embed({
    text,
    model: appConfig.resolver.embedModel,
    dimensions: appConfig.resolver.embedDimensions
  });
  await goalsRepository.setEmbedding(goalId, out.vector, out.model, out.dimensions);
}

/**
 * Backfill — uzupełnia embedding dla pojedynczego celu (np. po imporcie).
 */
export async function reembedGoalUseCase(goalId: string): Promise<ProjectGoal | null> {
  const g = await goalsRepository.get(goalId);
  if (!g) return null;
  await embedAndPersist(goalId, `${g.title}\n${g.description ?? ''}`.trim());
  return goalsRepository.get(goalId);
}

/**
 * Korelacja akcji z celami (cosine over wspólny model wektorowy).
 * Algorytm:
 *  1. embed(actionText) tym samym modelem co cele
 *  2. cosine z każdym aktywnym celem mającym embedding
 *  3. score effektywny = score * weight (priorytet celu)
 *  4. filtr ≥ minScore, sort desc, top K
 *  5. emit `resolver.correlation.computed`
 */
export async function correlateActionUseCase(input: CorrelateInput): Promise<CorrelationResult> {
  const topK     = input.topK     ?? appConfig.resolver.topK;
  const minScore = input.minScore ?? appConfig.resolver.minScore;
  const polarity = input.polarity ?? 'positive';
  const sign     = polarity === 'negative' ? -1 : 1;
  const model    = appConfig.resolver.embedModel;
  const dim      = appConfig.resolver.embedDimensions;

  const goals = (await goalsRepository.list(input.uid, 'active'))
    .filter(g => Array.isArray(g.embedding) && g.embedding!.length > 0);

  // Pusty zestaw celów → pusty wynik (bez wywołania LLM-a, oszczędność).
  if (goals.length === 0) {
    return {
      uid: input.uid,
      sessionId: input.sessionId ?? null,
      actionRef: input.actionRef,
      actionText: input.actionText,
      computedAt: new Date().toISOString(),
      embeddingModel: model,
      embeddingDim: dim,
      topK,
      minScore,
      polarity,
      matches: [],
      dominant: null
    };
  }

  const out = await executeService.embed({
    text: input.actionText,
    model,
    dimensions: dim
  });
  const actionVec = out.vector;

  // Indeks po goalId dla propagacji parent→child
  const byId = new Map<string, ProjectGoal>();
  for (const g of goals) byId.set(g.goalId, g);

  // 1) score bezpośrednie (raw cosine)
  const direct: CorrelationMatch[] = [];
  for (const g of goals) {
    const score = cosine(actionVec, g.embedding!);
    if (score < minScore) continue;            // FILTR po raw score (czystość dopasowania)
    direct.push({
      goalId: g.goalId,
      title: g.title,
      score,
      weight: g.weight ?? 1,
      reason: `direct cosine=${score.toFixed(3)}`
    });
  }

  // 2) propagacja w górę przez parentId z dyskontem (np. 0.8)
  const discount = appConfig.resolver.parentDiscount;
  const propagated = new Map<string, CorrelationMatch>();
  for (const m of direct) {
    let cur = byId.get(m.goalId);
    let depth = 1;
    let propScore = m.score;
    while (cur?.parentId) {
      propScore = propScore * discount;
      if (propScore < minScore) break;          // ten sam próg czystości dla propagacji
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      const existing = propagated.get(parent.goalId);
      if (!existing || existing.score < propScore) {
        propagated.set(parent.goalId, {
          goalId: parent.goalId,
          title: parent.title,
          score: propScore,
          weight: parent.weight ?? 1,
          reason: `propagated from ${m.goalId} (depth=${depth}, discount=${discount.toFixed(2)})`
        });
      }
      cur = parent;
      depth++;
    }
  }

  // 3) merge: bezpośrednie wygrywają z propagowanymi tego samego celu
  const merged = new Map<string, CorrelationMatch>();
  for (const m of [...propagated.values(), ...direct]) {
    const prev = merged.get(m.goalId);
    if (!prev || prev.score < m.score) merged.set(m.goalId, m);
  }

  // 4) sortowanie po score × weight (effective)
  const matches: CorrelationMatch[] = [...merged.values()]
    .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
    .slice(0, topK);

  const dominant = matches.length > 0 ? matches[0] : null;

  const result: CorrelationResult = {
    uid: input.uid,
    sessionId: input.sessionId ?? null,
    actionRef: input.actionRef,
    actionText: input.actionText,
    computedAt: new Date().toISOString(),
    embeddingModel: out.model,
    embeddingDim: out.dimensions,
    topK,
    minScore,
    polarity,
    matches: matches.map(m => ({ ...m, score: m.score * sign })),
    dominant: dominant ? { ...dominant, score: dominant.score * sign } : null
  };

  const eventName = polarity === 'negative'
    ? 'resolver.correlation.negative'
    : 'resolver.correlation.computed';
  eventBus.publish(eventName, {
    actionRef: input.actionRef,
    polarity,
    matches: result.matches.map(m => ({ goalId: m.goalId, score: m.score })),
    dominant: result.dominant ? { goalId: result.dominant.goalId, score: result.dominant.score } : null
  }, input.sessionId ?? undefined);

  return result;
}
