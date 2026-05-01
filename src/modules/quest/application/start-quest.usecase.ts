import { questRepository } from '../infrastructure/quest.repository';
import { questRules } from '../domain/quest.rules';
import { eventBus } from '../../../core/events/event-bus';

export interface StartQuestInput {
  userId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

export interface BranchQuestInput extends StartQuestInput {
  parentId: string;
  branchKey?: string | null;
}

export class StartQuestUseCase {
  async run(input: StartQuestInput) {
    const quest = await questRepository.create(input.userId, input.title, {
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria
    });
    eventBus.publish('quest.started', {
      questId: quest.id, userId: quest.userId, title: quest.title
    });
    return quest;
  }

  /**
   * Tworzy subquest jako gałąź (forked path) istniejącego questa.
   */
  async branch(input: BranchQuestInput) {
    const parent = await questRepository.findById(input.parentId);
    if (!parent) throw new Error(`parent quest not found: ${input.parentId}`);
    if (parent.userId !== input.userId) throw new Error('forbidden: parent belongs to another user');
    questRules.ensureBranchable(parent, input.branchKey);
    const sub = await questRepository.create(input.userId, input.title, {
      parentId: input.parentId,
      branchKey: input.branchKey,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria
    });
    eventBus.publish('quest.branched', {
      parentId: input.parentId, questId: sub.id,
      branchKey: input.branchKey ?? null, title: sub.title
    });
    return sub;
  }
}

export const startQuestUseCase = new StartQuestUseCase();
