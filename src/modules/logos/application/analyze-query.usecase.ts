import { executeService, AnalyzeInput, AnalyzeOutput, AnalyzeChunk } from '../../../infrastructure/ai/execute.service';
import { intentMapRepository } from '../../memory/infrastructure/intent-map.repository';
import { embeddingRepository } from '../../memory/infrastructure/embedding.repository';
import { eventBus } from '../../../core/events/event-bus';
import { appConfig } from '../../../core/config/app.config';
import { correlateActionUseCase } from '../../resolver/application/correlate-action.usecase';

export interface AnalyzeRunInput extends Omit<AnalyzeInput, 'intentMap' | 'ragContext'> {
  /** UID użytkownika — wymagany do auto-korelacji z celami projektu. */
  uid?: string;
}

export class AnalyzeQueryUseCase {
  async run(sessionId: string, input: AnalyzeRunInput): Promise<AnalyzeOutput> {
    eventBus.publish('logos.analyze.started', { query: input.query }, sessionId);

    const [intentMap, ragContext] = await Promise.all([
      intentMapRepository.get(sessionId).catch(() => null),
      embeddingRepository.buildContext(sessionId, input.query).catch(() => '')
    ]);

    const out = await executeService.analyze({
      ...input,
      intentMap: intentMap?.map,
      ragContext: ragContext || undefined
    });

    // Indeksuj odpowiedź jako kolejny fragment pamięci wektorowej.
    embeddingRepository.ingest(sessionId, out.text, { kind: 'logos.answer' }).catch(() => {});

    eventBus.publish('logos.analyze.completed', {
      provider: out.provider,
      model: out.model,
      length: out.text.length,
      ragHits: ragContext ? ragContext.split('---').length : 0
    }, sessionId);

    this.fireAutoCorrelate(sessionId, input);

    return out;
  }

  async *runStream(sessionId: string, input: AnalyzeRunInput): AsyncIterable<AnalyzeChunk> {
    eventBus.publish('logos.analyze.started', { query: input.query, mode: 'stream' }, sessionId);

    const [intentMap, ragContext] = await Promise.all([
      intentMapRepository.get(sessionId).catch(() => null),
      embeddingRepository.buildContext(sessionId, input.query).catch(() => '')
    ]);

    const enriched = { ...input, intentMap: intentMap?.map, ragContext: ragContext || undefined };
    let full = '';
    for await (const chunk of executeService.analyzeStream(enriched)) {
      if (chunk.delta) full += chunk.delta;
      yield chunk;
    }

    embeddingRepository.ingest(sessionId, full, { kind: 'logos.answer' }).catch(() => {});
    eventBus.publish('logos.analyze.completed', {
      provider: this.lastProvider, length: full.length, mode: 'stream'
    }, sessionId);

    this.fireAutoCorrelate(sessionId, input);
  }

  /**
   * Auto-korelacja: po każdej analizie budzimy Intent Resolver (fire-and-forget).
   * System nie jest ślepy na własne cele — każde zapytanie jest rzutowane na
   * przestrzeń celów 1024D. Wynik trafia do EventBus i WS jako
   * `resolver.correlation.computed`.
   */
  private fireAutoCorrelate(sessionId: string, input: AnalyzeRunInput): void {
    if (!appConfig.resolver.autoCorrelate) return;
    const uid = input.uid;
    if (!uid || uid === 'anonymous') return;   // anonimowi nie mają celów projektu
    if (!input.query || input.query.trim().length === 0) return;

    const actionRef = `logos:analyze:${sessionId}:${Date.now()}`;
    correlateActionUseCase({
      uid,
      sessionId,
      actionRef,
      actionText: input.query
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[resolver] auto-correlate failed:', (err as Error).message);
    });
  }

  private lastProvider = executeService.primaryProviderName();
}

export const analyzeQueryUseCase = new AnalyzeQueryUseCase();
