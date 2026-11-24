import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";
import { LimpezaDosSpans } from "./limpar-spans.ts";

describe("filtro do rastreio (M6-02)", () => {
  it("o span sai sem os valores da consulta, sem o token do bot, sem o IP e sem o navegador", () => {
    const memoria = new InMemorySpanExporter();
    const provedor = new TracerProvider({
      spanProcessors: [new LimpezaDosSpans(), new SimpleSpanProcessor({ exporter: memoria })],
    });
    const span = provedor.getTracer("teste").startSpan("GET", {
      attributes: {
        "url.full": "https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0/sendMessage",
        "http.target": "/busca?texto=contrato%20secreto&tipo=tarefas",
        "url.query": "texto=contrato%20secreto",
        "client.address": "203.0.113.9",
        "user_agent.original": "Mozilla/5.0",
        "http.route": "/busca",
        "db.statement": "select 1 where email = 'ana@teste.com'",
      },
    });
    span.addEvent("exception", {
      "exception.message": "falhou em https://h/bot1234567:abcdefghijklmnopqrstuvwxyz0123456789/getFile",
    });
    span.end();
    const [saiu] = memoria.getFinishedSpans();
    expect(saiu?.attributes).toEqual({
      "url.full": "https://api.telegram.org/bot[token]/sendMessage",
      "http.target": "/busca?texto=…&tipo=…",
      "url.query": "texto=…",
      "http.route": "/busca",
      "db.statement": "select 1 where email = '[e-mail]'",
    });
    expect(saiu?.events[0]?.attributes?.["exception.message"]).toBe("falhou em https://h/bot[token]/getFile");
  });
});
