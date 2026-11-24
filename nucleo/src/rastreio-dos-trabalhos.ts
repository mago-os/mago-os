/**
 * O número de rastreio que segue o trabalho inteiro (M6-02): do pedido da tela para a fila, da fila para o motor dos
 * agentes, para o Telegram e para as rotinas. Um trabalho que nasce de outro leva o número de quem o criou.
 *
 * O número é o trace id do OpenTelemetry (decisão 0003). Para não depender do OpenTelemetry estar ligado (nos testes e
 * no Mac ele fica sem destino), o número também anda num AsyncLocalStorage próprio: o pedido HTTP o põe ali (no
 * servidor), e cada trabalho da fila o recebe nos dados e o põe de volta antes de rodar.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";

/** O que vai junto nos dados de um trabalho da fila. */
export interface RastreioLevado {
  /** O número de rastreio (32 caracteres hexadecimais). */
  rastreio?: string;
  /** O contexto W3C do OpenTelemetry, quando ele está ligado (o trabalho vira filho do pedido no painel). */
  traceparent?: string;
}

const armazem = new AsyncLocalStorage<{ rastreio: string }>();
const FORMATO = /^[0-9a-f]{32}$/;
const PAI = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export const novoNumeroDeRastreio = (): string => randomBytes(16).toString("hex");

/** Roda o resto do pedido (ou do trabalho) com este número de rastreio. */
export function comNumeroDeRastreio<T>(rastreio: string, fazer: () => T): T {
  return armazem.run({ rastreio }, fazer);
}

/** O número de rastreio de agora: o do OpenTelemetry, se ligado; senão, o do pedido ou do trabalho. */
export function rastreioAtual(): string | null {
  const span = trace.getActiveSpan()?.spanContext();
  if (span && trace.isSpanContextValid(span)) return span.traceId;
  return armazem.getStore()?.rastreio ?? null;
}

/** O que levar nos dados de um trabalho novo, para ele continuar o rastreio de agora. */
export function levarRastreio(): RastreioLevado {
  const span = trace.getActiveSpan()?.spanContext();
  const rastreio = rastreioAtual();
  return {
    ...(rastreio ? { rastreio } : {}),
    ...(span && trace.isSpanContextValid(span)
      ? {
          traceparent: `00-${span.traceId}-${span.spanId}-0${(span.traceFlags & TraceFlags.SAMPLED).toString(16)}`,
        }
      : {}),
  };
}

/**
 * Roda um trabalho da fila continuando o rastreio de quem o criou (ou com um número novo, se ele não veio de um
 * pedido, como a verificação a cada minuto). O trabalho recebe o número, para pôr nos registros.
 */
export async function continuarRastreio<T>(
  levado: RastreioLevado | null | undefined,
  nome: string,
  fazer: (rastreio: string) => Promise<T>,
): Promise<T> {
  const pai = PAI.exec(levado?.traceparent ?? "");
  const contextoDoPai = pai
    ? trace.setSpanContext(ROOT_CONTEXT, {
        traceId: pai[1] as string,
        spanId: pai[2] as string,
        traceFlags: Number.parseInt(pai[3] as string, 16),
        isRemote: true,
      })
    : ROOT_CONTEXT;
  return trace
    .getTracer("mago-os-nucleo")
    .startActiveSpan(nome, { kind: SpanKind.CONSUMER }, contextoDoPai, async (span) => {
      const doSpan = span.spanContext();
      const rastreio = trace.isSpanContextValid(doSpan)
        ? doSpan.traceId
        : levado?.rastreio && FORMATO.test(levado.rastreio)
          ? levado.rastreio
          : novoNumeroDeRastreio();
      try {
        return await comNumeroDeRastreio(rastreio, () => fazer(rastreio));
      } catch (erro) {
        span.recordException(erro as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw erro;
      } finally {
        span.end();
      }
    });
}
