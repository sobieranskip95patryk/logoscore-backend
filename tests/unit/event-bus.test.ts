import { eventBus } from '../../src/core/events/event-bus';

describe('EventBus', () => {
  it('publishes envelope and notifies subscribers', (done) => {
    const off = eventBus.subscribe('system.boot', (e) => {
      expect(e.name).toBe('system.boot');
      expect(e.payload).toEqual({ ok: true });
      off();
      done();
    });
    eventBus.publish('system.boot', { ok: true });
  });
});
