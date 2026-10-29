import { context, propagation, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'

// Context dan propagator W3C selalu dipasang supaya traceparent tetap diteruskan; span hanya diekspor kalau endpoint OTLP diisi.
export function startTelemetry(service: string, otlpTracesEndpoint: string | undefined) {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  if (!otlpTracesEndpoint) return { shutdown: async () => {} }

  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': service }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: otlpTracesEndpoint }) })],
  })
  trace.setGlobalTracerProvider(provider)
  return { shutdown: () => provider.shutdown() }
}

export const currentTraceparent = (): string | undefined => {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return carrier.traceparent
}
