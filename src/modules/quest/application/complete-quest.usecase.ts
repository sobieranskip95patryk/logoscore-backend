import { questRepository } from '../infrastructure/quest.repository';
import { questRules } from '../domain/quest.rules';
import { eventBus } from '../../../core/events/event-bus';

/**
 * Domyka transition IN_PROGRESS → COMPLETED.
 * Po sukcesie emituje `quest.completed` — bridge resolvera nasłuchuje na ten event
 * i automatycznie koreluje wykonane zadanie z mapą celów (1024D).
 */
export class CompleteQuestUseCase {
  async run(questId: string) {
    const quest = await questRepository.findById(questId);
    if (!quest) throw new Error(`quest ${questId} not found`);

    questRules.ensureCompletable(quest);
    quest.state = 'COMPLETED';
    const updated = await questRepository.update(quest);

    eventBus.publish('quest.completed', {
      questId: updated.id,
      userId: updated.userId,
      title: updated.title,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      parentId: updated.parentId,
      branchKey: updated.branchKey
    });
    return updated;
  }
}

export const completeQuestUseCase = new CompleteQuestUseCase();
