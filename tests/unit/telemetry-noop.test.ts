/**
 * Sprint XI — telemetry NoOp safety:
 *  - bez paczek @opentelemetry/* i bez TELEMETRY_ENABLED → NoOp tracer
 *  - withSpan zwraca wartość fn, nie throwuje, nie loguje
 */
process.env.TELEMETRY_ENABLED = 'false';

import { initTelemetry, getTracer } from '../../src/infrastructure/observability/telemetry';

describe('telemetry NoOp safety', () => {
  beforeAll(() => initTelemetry());

  it('startSpan zwraca obiekt z metodami no-op', () => {
    const span = getTracer().startSpan('test.span', { foo: 'bar' });
    expect(typeof span.setAttribute).toBe('function');
    expect(typeof span.setStatus).toBe('function');
    expect(typeof span.recordException).toBe('function');
    expect(typeof span.end).toBe('function');
    // wszystkie metody no-op nie powinny rzucać
    expect(() => span.setAttribute('a', 1)).not.toThrow();
    expect(() => span.setStatus({ code: 'ok' })).not.toThrow();
    expect(() => span.recordException(new Error('x'))).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });

  it('withSpan zwraca wynik fn bez modyfikacji', async () => {
    const result = await getTracer().withSpan('op', async () => 42);
    expect(result).toBe(42);
  });

  it('withSpan propaguje wyjątki', async () => {
    await expect(
      getTracer().withSpan('op', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});
