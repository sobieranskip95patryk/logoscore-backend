import { TransitionDefinition } from './state.types';

/**
 * Globalne, współdzielone definicje przejść stanu (np. dla questów).
 * Każdy moduł może dostarczać własne transitions, ten zbiór to tylko domyślne.
 */
export const defaultQuestTransitions: TransitionDefinition[] = [
  { from: 'IDLE',        to: 'IN_PROGRESS', on: 'START' },
  { from: 'IN_PROGRESS', to: 'COMPLETED',   on: 'COMPLETE' },
  { from: 'COMPLETED',   to: 'REWARDED',    on: 'REWARD' },
  { from: 'IN_PROGRESS', to: 'FAILED',      on: 'FAIL' }
];

export const QUEST_STATES = ['IDLE', 'IN_PROGRESS', 'COMPLETED', 'REWARDED', 'FAILED'] as const;
