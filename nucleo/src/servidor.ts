/**
 * Servidor HTTP do núcleo (Fastify). Não guarda estado: pode ser reiniciado ou duplicado a qualquer hora.
 */
import { randomBytes } from "node:crypto";
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import type { Banco } from "./banco.ts";
import type { Config } from "./config.ts";
import { sobreOSistema } from "./index.ts";

/** Número de rastreio do pedido: o trace id do OpenTelemetry, ou um novo no mesmo formato se não houver. */
export function numeroDeRastreio(): string {
  const contexto = trace.getActiveSpan()?.spanContext();
  if (contexto && trace.isSpanContextValid(contexto)) return contexto.traceId;
  return randomBytes(16).toString("hex");
}

export interface RespostaSaude {
  situacao: "ok" | "com_problema";
  api: "ok";
  banco: "ok" | "fora_do_ar";
  sistema: string;
  ambiente: Config["ambiente"];
}

export interface OpcoesDoServidor {
  /** Para onde vão os registros. Padrão: a saída do terminal (stdout), uma linha JSON por registro. */
  destinoDosRegistros?: { write(linha: string): void };
}

export function criarServidor(
  config: Pick<Config, "nivelRegistro" | "ambiente">,
  banco: Banco,
  opcoes: OpcoesDoServidor = {},
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.nivelRegistro,
      base: { servico: "mago-os-nucleo", ambiente: config.ambiente },
      messageKey: "mensagem",
      timestamp: () => `,"hora":"${new Date().toISOString()}"`,
      formatters: { level: (nivel) => ({ nivel }) },
      ...(opcoes.destinoDosRegistros ? { stream: opcoes.destinoDosRegistros } : {}),
    },
    logController: new LogController({ requestIdLogLabel: "rastreio" }),
    genReqId: () => numeroDeRastreio(),
  });

  app.addHook("onRequest", async (pedido, resposta) => {
    resposta.header("x-rastreio", pedido.id);
  });

  app.get("/saude", async (_pedido, resposta): Promise<RespostaSaude> => {
    const bancoOk = await banco.estaSaudavel();
    resposta.code(bancoOk ? 200 : 503);
    return {
      situacao: bancoOk ? "ok" : "com_problema",
      api: "ok",
      banco: bancoOk ? "ok" : "fora_do_ar",
      sistema: sobreOSistema().nome,
      ambiente: config.ambiente,
    };
  });

  return app;
}
