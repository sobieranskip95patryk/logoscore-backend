/**
 * Strongly-typed event names emitted on the system EventBus.
 * Naming convention: domain.action (lowercase, dot-separated).
 */
export type SystemEvent =
  | 'system.boot'
  | 'system.shutdown'
  | 'auth.user.session'
  | 'logos.analyze.started'
  | 'logos.analyze.completed'
  | 'logos.analyze.chunk'
  | 'logos.synthesize.completed'
  | 'memory.intent.updated'
  | 'memory.document.ingested'
  | 'memory.search.completed'
  | 'quest.started'
  | 'quest.completed'
  | 'quest.failed'
  | 'quest.rewarded'
  | 'quest.branched'
  | 'inventory.item.added'
  | 'inventory.item.removed'
  | 'resolver.goal.created'
  | 'resolver.goal.updated'
  | 'resolver.correlation.computed'
  | 'resolver.correlation.negative'
  | 'security.auth.success'
  | 'security.auth.failure'
  | 'security.rate_limited'
  | 'security.forbidden'
  | 'security.user.exported'
  | 'security.user.deleted'
  | 'state.transition';

export interface EventEnvelope<T = unknown> {
  id: string;
  name: SystemEvent;
  timestamp: string;
  sessionId?: string;
  payload: T;
}
