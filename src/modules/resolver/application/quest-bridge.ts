import { eventBus } from '../../../core/events/event-bus';
import { appConfig } from '../../../core/config/app.config';
import { correlateActionUseCase } from '../application/correlate-action.usecase';
import { questActionText } from '../../quest/domain/quest.entity';

interface QuestSignalPayload {
  questId: string;
  userId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  parentId?: string | null;
  branchKey?: string | null;
  reason?: string | null;
}

let installed = false;

function correlateFromQuest(p: QuestSignalPayload, polarity: 'positive' | 'negative'): void {
  if (!appConfig.resolver.autoCorrelate) return;
  if (!p?.userId || p.userId === 'anonymous') return;

  const actionText = questActionText({
    id: p.questId,
    userId: p.userId,
    title: p.title,
    description: p.description ?? null,
    acceptanceCriteria: p.acceptanceCriteria ?? null,
    state: polarity === 'negative' ? 'FAILED' : 'COMPLETED',
    createdAt: '',
    updatedAt: ''
  });
  if (!actionText) return;

  correlateActionUseCase({
    uid: p.userId,
    sessionId: undefined,
    actionRef: `quest:${p.questId}`,
    actionText,
    polarity
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.warn(`[resolver] quest bridge (${polarity}) correlate failed:`, (err as Error).message);
  });
}

/**
 * Quest ↔ Resolver bridge.
 * Każdy quest.completed → automatyczna korelacja z mapą celów (1024D).
 * Wynik trafia do EventBusa jako `resolver.correlation.computed` i przez WS
 * do klientów z subskrypcją (jeśli payload niesie sessionId — tu pomijany,
 * bo quest jest user-scoped, nie session-scoped).
 *
 * Bramki bezpieczeństwa:
 *  - autoCorrelate=false → no-op
 *  - userId='anonymous' lub puste → no-op (twórcy mają cele, goście nie)
 *  - actionText puste → no-op
 *
 * Zachowanie fire-and-forget — błąd nie wraca do producenta zdarzenia.
 */
export function installQuestResolverBridge(): void {
  if (installed) return;
  installed = true;

  eventBus.subscribe<QuestSignalPayload>('quest.completed', (envelope) => {
    correlateFromQuest(envelope.payload, 'positive');
  });

  eventBus.subscribe<QuestSignalPayload>('quest.failed', (envelope) => {
    correlateFromQuest(envelope.payload, 'negative');
  });

  // eslint-disable-next-line no-console
  console.log('[resolver] quest bridge installed (quest.completed/failed → correlate ±)');
}
