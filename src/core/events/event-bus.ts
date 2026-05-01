import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { EventEnvelope, SystemEvent } from './event.types';

/**
 * EventBus — centralny "układ nerwowy" backendu.
 * Każdy moduł (quest, user, inventory, logos, memory) komunikuje się przez ten kanał.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  publish<T>(name: SystemEvent, payload: T, sessionId?: string): EventEnvelope<T> {
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      name,
      timestamp: new Date().toISOString(),
      sessionId,
      payload
    };
    this.emit(name, envelope);
    this.emit('*', envelope);
    return envelope;
  }

  subscribe<T>(name: SystemEvent | '*', handler: (e: EventEnvelope<T>) => void): () => void {
    this.on(name, handler);
    return () => this.off(name, handler);
  }
}

export const eventBus = new EventBus();
export type { EventBus };
