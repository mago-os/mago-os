/**
 * Rastreio técnico (OpenTelemetry). Precisa carregar antes de tudo:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 *
 * Cada pedido ganha um número de rastreio (o trace id), que aparece nos registros e volta na resposta
 * no cabeçalho "x-rastreio". Os dados só saem do servidor se OTEL_EXPORTER_OTLP_ENDPOINT for informado
 * (o destino é escolhido no M6-02); sem isso, o número de rastreio existe mas nada é enviado.
 */
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { NodeSDK } from "@opentelemetry/sdk-node";

process.env.OTEL_TRACES_EXPORTER ??= process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? "otlp" : "none";
process.env.OTEL_METRICS_EXPORTER ??= "none";
process.env.OTEL_LOGS_EXPORTER ??= "none";
process.env.OTEL_SERVICE_NAME ??= "mago-os-nucleo";

const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation(),
    new PgInstrumentation(),
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ],
});
sdk.start();

process.once("beforeExit", () => {
  void sdk.shutdown();
});
