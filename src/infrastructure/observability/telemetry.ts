/**
 * Sprint XI — Observability: lekki tracer wrapper z lazy require.
 *
 * Filozofia:
 *  - Gdy `telemetry.enabled=false` lub paczki @opentelemetry/* nieobecne →
 *    NoOp tracer (zero overhead, zero rzuconych wyjątków).
 *  - Gdy enabled + OTLP endpoint skonfigurowany → real SDK z auto-instrumentacją
 *    HTTP/Express oraz manualnymi spanami w hot pathach AI (analyze/embed/synth).
 *
 * Inicjalizacja jest IDempotentna i wczesna — `initTelemetry()` musi być
 * pierwszą linią `server.ts` (przed importem ExecuteService), aby auto-instr
 * działała na wszystkich modułach.
 */
import { appConfig } from '../../core/config/app.config';

/** Minimalny kontrakt span'u który nas interesuje. */
export interface AppSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: 'ok' | 'error'; message?: string }): void;
  recordException(err: Error): void;
  end(): void;
}

export interface AppTracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): AppSpan;
  /** Pomocniczy wrapper: uruchamia fn wewnątrz spanu, zamyka span automatycznie. */
  withSpan<T>(name: string, fn: (span: AppSpan) => Promise<T>, attributes?: Record<string, string | number | boolean>): Promise<T>;
}

class NoopSpan implements AppSpan {
  setAttribute(): void { /* noop */ }
  setStatus(): void { /* noop */ }
  recordException(): void { /* noop */ }
  end(): void { /* noop */ }
}

class NoopTracer implements AppTracer {
  startSpan(): AppSpan { return new NoopSpan(); }
  async withSpan<T>(_name: string, fn: (span: AppSpan) => Promise<T>): Promise<T> {
    return fn(new NoopSpan());
  }
}

let activeTracer: AppTracer = new NoopTracer();
let initialized = false;
let initWarned = false;

/**
 * Inicjalizuje OpenTelemetry SDK jeśli enabled + paczki dostępne.
 * Idempotent — wielokrotne wywołania są no-op po pierwszym sukcesie.
 */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  if (!appConfig.telemetry.enabled) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trace, SpanStatusCode } = require('@opentelemetry/api');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: appConfig.telemetry.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || 'dev',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: appConfig.env
      }),
      traceExporter: appConfig.telemetry.otlpEndpoint
        ? new OTLPTraceExporter({ url: `${appConfig.telemetry.otlpEndpoint}/v1/traces` })
        : undefined,
      sampler: new TraceIdRatioBasedSampler(appConfig.telemetry.sampleRate),
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false } // za szumne
      })]
    });

    sdk.start();
    process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));

    const otelTracer = trace.getTracer(appConfig.telemetry.serviceName);

    activeTracer = {
      startSpan(name, attributes) {
        const span = otelTracer.startSpan(name, { attributes });
        return wrapOtelSpan(span, SpanStatusCode);
      },
      async withSpan(name, fn, attributes) {
        const span = otelTracer.startSpan(name, { attributes });
        const wrapped = wrapOtelSpan(span, SpanStatusCode);
        try {
          const result = await fn(wrapped);
          wrapped.setStatus({ code: 'ok' });
          return result;
        } catch (err) {
          wrapped.recordException(err as Error);
          wrapped.setStatus({ code: 'error', message: (err as Error).message });
          throw err;
        } finally {
          wrapped.end();
        }
      }
    };
  } catch (err) {
    if (!initWarned) {
      initWarned = true;
      console.warn(`[telemetry] OpenTelemetry init failed: ${(err as Error).message} — fallback to NoOp tracer`);
    }
  }
}

function wrapOtelSpan(span: any, SpanStatusCode: any): AppSpan {
  return {
    setAttribute: (k, v) => span.setAttribute(k, v),
    setStatus: (s) => span.setStatus({
      code: s.code === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: s.message
    }),
    recordException: (err) => span.recordException(err),
    end: () => span.end()
  };
}

export function getTracer(): AppTracer { return activeTracer; }
