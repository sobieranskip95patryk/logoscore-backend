import { questRules } from '../../src/modules/quest/domain/quest.rules';
import { QuestEntity, questActionText } from '../../src/modules/quest/domain/quest.entity';

const base = (over: Partial<QuestEntity> = {}): QuestEntity => ({
  id: '1', userId: 'u', title: 't', state: 'IN_PROGRESS',
  reward: null, createdAt: '', updatedAt: '', ...over
});

describe('questRules', () => {
  it('allows IDLE -> IN_PROGRESS', () => {
    expect(questRules.canTransition('IDLE', 'IN_PROGRESS')).toBe(true);
  });
  it('blocks IDLE -> REWARDED', () => {
    expect(questRules.canTransition('IDLE', 'REWARDED')).toBe(false);
  });
  it('rejects reward when not COMPLETED', () => {
    expect(() => questRules.ensureRewardable(base({ state: 'IN_PROGRESS' }))).toThrow();
  });
  it('accepts reward gdy COMPLETED', () => {
    expect(() => questRules.ensureRewardable(base({ state: 'COMPLETED' }))).not.toThrow();
  });
  it('ensureCompletable: throw poza IN_PROGRESS', () => {
    expect(() => questRules.ensureCompletable(base({ state: 'COMPLETED' }))).toThrow();
    expect(() => questRules.ensureCompletable(base({ state: 'IN_PROGRESS' }))).not.toThrow();
  });
  it('ensureFailable: throw poza IN_PROGRESS', () => {
    expect(() => questRules.ensureFailable(base({ state: 'FAILED' }))).toThrow();
    expect(() => questRules.ensureFailable(base({ state: 'IN_PROGRESS' }))).not.toThrow();
  });
  it('ensureBranchable: blokuje sealed parents', () => {
    expect(() => questRules.ensureBranchable(base({ state: 'REWARDED' }))).toThrow();
    expect(() => questRules.ensureBranchable(base({ state: 'FAILED' }))).toThrow();
  });
  it('ensureBranchable: walidacja branchKey', () => {
    expect(() => questRules.ensureBranchable(base(), 'bad key!')).toThrow();
    expect(() => questRules.ensureBranchable(base(), 'good_key-1')).not.toThrow();
  });
  it('isParentResolvable: wszystkie dzieci COMPLETED/REWARDED', () => {
    expect(questRules.isParentResolvable([])).toBe(false);
    expect(questRules.isParentResolvable([base({ state: 'COMPLETED' }), base({ state: 'REWARDED' })])).toBe(true);
    expect(questRules.isParentResolvable([base({ state: 'COMPLETED' }), base({ state: 'IN_PROGRESS' })])).toBe(false);
  });
});

describe('questActionText (gęsty lądownik wektorowy)', () => {
  it('skleja niepuste warstwy join \\n', () => {
    const txt = questActionText(base({
      title: 'T', description: 'D', acceptanceCriteria: 'AC'
    }));
    expect(txt).toBe('T\nD\nAC');
  });
  it('pomija puste warstwy', () => {
    expect(questActionText(base({ title: 'tylko-tytul' }))).toBe('tylko-tytul');
  });
});
