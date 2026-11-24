/**
 * Filtro do rastreio (M6-02): o mesmo cuidado dos registros, para os spans que vão ao destino central. As
 * instrumentações do HTTP, do Fastify e do fetch gravam o endereço inteiro (com os valores da consulta, que podem ter
 * texto de tarefa, e o token do bot do Telegram no caminho), o IP e o navegador de quem pediu. Este processador roda
 * antes do envio e troca ou tira esses atributos.
 */
import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";
import { enderecoSemValores, limparTexto } from "./registros.ts";

/** Atributos com um endereço: vão sem os valores da consulta. */
const ENDERECOS = new Set(["url.full", "url.path", "http.url", "http.target", "url.original"]);
/** Atributos de quem pediu (IP, porta e navegador): não saem. */
const DE_QUEM_PEDIU = new Set([
  "client.address",
  "client.port",
  "network.peer.address",
  "network.peer.port",
  "net.peer.ip",
  "net.peer.port",
  "net.sock.peer.addr",
  "net.sock.peer.port",
  "http.client_ip",
  "user_agent.original",
  "http.user_agent",
]);

/** Só os nomes da consulta ("texto=…&tipo=…"). */
const consultaSemValores = (consulta: string) =>
  consulta
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .map((p) => `${p.split("=")[0]}=…`)
    .join("&");

/** Limpa os atributos de um span ou de um evento dele (muda o próprio objeto). */
export function limparAtributos(atributos: Record<string, unknown>): void {
  for (const [nome, valor] of Object.entries(atributos)) {
    if (DE_QUEM_PEDIU.has(nome)) {
      delete atributos[nome];
      continue;
    }
    if (typeof valor !== "string") continue;
    if (nome === "url.query") atributos[nome] = consultaSemValores(valor);
    else if (ENDERECOS.has(nome)) atributos[nome] = enderecoSemValores(valor);
    else atributos[nome] = limparTexto(valor);
  }
}

export class LimpezaDosSpans implements SpanProcessor {
  onStart(_span: Span, _contexto: Context): void {}

  onEnd(span: ReadableSpan): void {
    limparAtributos(span.attributes as Record<string, unknown>);
    for (const evento of span.events)
      if (evento.attributes) limparAtributos(evento.attributes as Record<string, unknown>);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
