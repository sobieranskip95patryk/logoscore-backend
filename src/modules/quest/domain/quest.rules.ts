import { QuestEntity, QuestState } from './quest.entity';

const ALLOWED: Record<QuestState, QuestState[]> = {
  IDLE:        ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED', 'FAILED'],
  COMPLETED:   ['REWARDED'],
  REWARDED:    [],
  FAILED:      []
};

export const questRules = {
  canTransition(current: QuestState, next: QuestState): boolean {
    return ALLOWED[current]?.includes(next) ?? false;
  },
  ensureCompletable(q: QuestEntity): void {
    if (q.state !== 'IN_PROGRESS') {
      throw new Error(`quest ${q.id} not completable in state ${q.state}`);
    }
  },
  ensureFailable(q: QuestEntity): void {
    if (q.state !== 'IN_PROGRESS') {
      throw new Error(`quest ${q.id} not failable in state ${q.state}`);
    }
  },
  ensureRewardable(q: QuestEntity): void {
    if (q.state !== 'COMPLETED') {
      throw new Error(`quest ${q.id} not rewardable in state ${q.state}`);
    }
  },
  /**
   * Subquest może powstać tylko gdy rodzic istnieje i nie jest w stanie końcowym.
   * Forked path = wiele dzieci tego samego rodzica z różnymi branchKey.
   */
  ensureBranchable(parent: QuestEntity, branchKey?: string | null): void {
    if (parent.state === 'REWARDED' || parent.state === 'FAILED') {
      throw new Error(`quest ${parent.id} is sealed (${parent.state}), cannot branch`);
    }
    if (branchKey && !/^[A-Za-z0-9_-]{1,64}$/.test(branchKey)) {
      throw new Error(`invalid branchKey: ${branchKey}`);
    }
  },
  /**
   * Rodzic uznajemy za COMPLETED gdy wszystkie dzieci są COMPLETED lub REWARDED.
   */
  isParentResolvable(children: QuestEntity[]): boolean {
    if (children.length === 0) return false;
    return children.every(c => c.state === 'COMPLETED' || c.state === 'REWARDED');
  }
};
