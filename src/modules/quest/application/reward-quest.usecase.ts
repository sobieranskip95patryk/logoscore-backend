import { questRepository } from '../infrastructure/quest.repository';
import { questRules } from '../domain/quest.rules';
import { eventBus } from '../../../core/events/event-bus';

export class RewardQuestUseCase {
  async run(questId: string, reward?: Record<string, unknown>) {
    const quest = await questRepository.findById(questId);
    if (!quest) throw new Error(`quest ${questId} not found`);

    questRules.ensureRewardable(quest);

    quest.reward = reward ?? { gold: 1 };
    quest.state = 'REWARDED';
    const updated = await questRepository.update(quest);

    eventBus.publish('quest.rewarded', { questId: updated.id, reward: updated.reward });
    return updated;
  }
}

export const rewardQuestUseCase = new RewardQuestUseCase();
