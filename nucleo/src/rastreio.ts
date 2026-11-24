/**
 * Rastreio técnico (OpenTelemetry). Precisa carregar antes de tudo:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 *
 * Cada pedido ganha um número de rastreio (o trace id), que aparece nos registros e volta na resposta
 * no cabeçalho "x-rastreio". Os dados só saem do servidor se OTEL_EXPORTER_OTLP_ENDPOINT for informado
 * (M6-02: o Grafana Cloud, com OTEL_EXPORTER_OTLP_HEADERS); sem isso, o número de rastreio existe mas nada é
 * enviado. Com o destino, vão o rastreio (cada pedido e cada trabalho da fila, com as consultas ao banco e as
 * chamadas para fora) e os registros, já sem dado pessoal (o filtro do servidor.ts roda antes).
 */
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";

const comDestino = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
process.env.OTEL_TRACES_EXPORTER ??= comDestino ? "otlp" : "none";
process.env.OTEL_METRICS_EXPORTER ??= "none";
process.env.OTEL_LOGS_EXPORTER ??= comDestino ? "otlp" : "none";
process.env.OTEL_SERVICE_NAME ??= "mago-os-nucleo";

const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation(),
    new PgInstrumentation(),
    // As chamadas para fora pelo fetch (provedores de IA, Telegram, Backblaze) entram no rastreio do trabalho.
    new UndiciInstrumentation(),
    // Os registros vão para o destino junto com o rastreio; o número já está no campo "rastreio".
    new PinoInstrumentation({ disableLogCorrelation: true }),
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ],
});
sdk.start();

process.once("beforeExit", () => {
  void sdk.shutdown();
});
