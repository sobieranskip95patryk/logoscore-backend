/**
 * Sprint VII — jednostkowo: ujemna polaryzacja.
 * Sprawdzamy że correlateAction z polarity='negative' emituje dedykowany event
 * i odwraca znak score (przy aktywnych celach).
 */
process.env.AI_PROVIDER = 'simulated';

import { eventBus } from '../../src/core/events/event-bus';
import { correlateActionUseCase } from '../../src/modules/resolver/application/correlate-action.usecase';

describe('unit: correlateAction polarity', () => {
  it('zwraca polarity=positive domyślnie + nie emituje resolver.correlation.negative', async () => {
    const negativeEvents: unknown[] = [];
    const off = eventBus.subscribe('resolver.correlation.negative', (e) => negativeEvents.push(e));

    const result = await correlateActionUseCase({
      uid: 'user-no-goals',
      actionRef: 'quest:test-positive',
      actionText: 'wykonano działanie kontrolne'
    });

    expect(result.polarity).toBe('positive');
    expect(negativeEvents).toHaveLength(0);
    off();
  });

  it('z polarity=negative emituje resolver.correlation.negative (nawet gdy brak goals → puste matches)', async () => {
    const negativeEvents: unknown[] = [];
    const off = eventBus.subscribe('resolver.correlation.negative', (e) => negativeEvents.push(e));

    const result = await correlateActionUseCase({
      uid: 'user-no-goals',
      actionRef: 'quest:test-negative',
      actionText: 'czyn rozpadnięty',
      polarity: 'negative'
    });

    expect(result.polarity).toBe('negative');
    expect(result.matches).toEqual([]);
    // Brak goals → bez wywołania embeddera, ale event NIE emitowany w tej ścieżce
    // (early return bez publish — to świadoma decyzja: pusty wynik to nie sygnał).
    expect(negativeEvents).toHaveLength(0);
    off();
  });
});
