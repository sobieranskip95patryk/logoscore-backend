import { questRepository } from '../infrastructure/quest.repository';
import { questRules } from '../domain/quest.rules';
import { eventBus } from '../../../core/events/event-bus';

/**
 * Lustro CompleteQuestUseCase: domyka transition IN_PROGRESS → FAILED.
 * Po sukcesie emituje `quest.failed` — bridge resolvera nasłuchuje na ten event
 * i wykonuje korelację o polarity='negative' (anty-cel: score zapisywany ze znakiem -).
 *
 * Sprzężenie zwrotne: system uczy się odróżniać czyny owocujące od jałowych,
 * a mapa intencji odzyskuje czystość przez ujemną propagację.
 */
export class FailQuestUseCase {
  async run(questId: string, reason?: string) {
    const quest = await questRepository.findById(questId);
    if (!quest) throw new Error(`quest ${questId} not found`);

    questRules.ensureFailable(quest);
    quest.state = 'FAILED';
    const updated = await questRepository.update(quest);

    eventBus.publish('quest.failed', {
      questId: updated.id,
      userId: updated.userId,
      title: updated.title,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      parentId: updated.parentId,
      branchKey: updated.branchKey,
      reason: reason ?? null
    });
    return updated;
  }
}

export const failQuestUseCase = new FailQuestUseCase();
