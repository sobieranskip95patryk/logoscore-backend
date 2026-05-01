import { eventBus } from '../events/event-bus';
import {
  StateMachineDefinition,
  StateSnapshot,
  TransitionDefinition
} from './state.types';

/**
 * Lekki silnik state-machine. Stan trzymany w pamięci instancji.
 * Persystencję (Postgres/Redis) podpina się przez listenery EventBusa.
 */
export class StateMachineEngine<TContext = any> {
  private state: string;

  constructor(
    private readonly definition: StateMachineDefinition<TContext>,
    private context: TContext
  ) {
    this.state = definition.initial;
  }

  current(): StateSnapshot<TContext> {
    return {
      machineId: this.definition.id,
      state: this.state,
      context: this.context,
      updatedAt: new Date().toISOString()
    };
  }

  async send(event: string): Promise<StateSnapshot<TContext>> {
    const transition = this.definition.transitions.find(
      (t: TransitionDefinition<TContext>) => t.from === this.state && t.on === event
    );
    if (!transition) {
      throw new Error(
        `[state-machine:${this.definition.id}] no transition for "${event}" from "${this.state}"`
      );
    }
    if (transition.guard && !transition.guard(this.context)) {
      throw new Error(`[state-machine:${this.definition.id}] guard rejected "${event}"`);
    }
    if (transition.effect) {
      await transition.effect(this.context);
    }
    const previous = this.state;
    this.state = transition.to;

    eventBus.publish('state.transition', {
      machineId: this.definition.id,
      from: previous,
      to: this.state,
      on: event
    });

    return this.current();
  }
}
