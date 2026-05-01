/**
 * Generic state-machine types.
 * State-machine to "kontrola przepływu stanu" wg LOGOS v5.3.
 */
export type StateName = string;

export interface TransitionDefinition<TContext = any> {
  from: StateName;
  to: StateName;
  on: string;
  guard?: (ctx: TContext) => boolean;
  effect?: (ctx: TContext) => void | Promise<void>;
}

export interface StateMachineDefinition<TContext = any> {
  id: string;
  initial: StateName;
  states: StateName[];
  transitions: TransitionDefinition<TContext>[];
}

export interface StateSnapshot<TContext = any> {
  machineId: string;
  state: StateName;
  context: TContext;
  updatedAt: string;
}
