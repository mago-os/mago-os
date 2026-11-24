/**
 * Servidor HTTP do núcleo (Fastify). Não guarda estado: pode ser reiniciado ou duplicado a qualquer hora.
 */
import { AsyncResource } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyInstance, LogController, type RouteOptions } from "fastify";
import type { Banco } from "./banco.ts";
import type { Config } from "./config.ts";
import { sobreOSistema } from "./index.ts";
import { comNumeroDeRastreio, rastreioAtual } from "./rastreio-dos-trabalhos.ts";
import { enderecoSemValores, limparRegistro, limparTexto } from "./registros.ts";

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
  versao: string;
}

export interface OpcoesDoServidor {
  /** Para onde vão os registros. Padrão: a saída do terminal (stdout), uma linha JSON por registro. */
  destinoDosRegistros?: { write(linha: string): void };
  /** Nos testes: cada rota registrada, desde a primeira (o teste de vazamento confere que cobre todas). */
  aoRegistrarRota?: (rota: RouteOptions) => void;
}

/** O texto fixo de um registro filho do pino (as "chindings"), sem depender do pacote do pino. */
function textoFixoDoRegistro(registro: object): unknown {
  let alvo: object | null = registro;
  while (alvo) {
    const simbolo = Object.getOwnPropertySymbols(alvo).find((x) => x.description === "pino.chindings");
    if (simbolo) return (alvo as Record<symbol, unknown>)[simbolo];
    alvo = Object.getPrototypeOf(alvo);
  }
  return undefined;
}

/** O contexto assíncrono de cada pedido (com o número de rastreio), retomado depois da leitura do corpo. */
const contextoDoPedido = new WeakMap<object, AsyncResource>();

export function criarServidor(
  config: Pick<Config, "nivelRegistro" | "ambiente"> & Partial<Pick<Config, "versao">>,
  banco: Banco,
  opcoes: OpcoesDoServidor = {},
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.nivelRegistro,
      base: { servico: "mago-os-nucleo", ambiente: config.ambiente, versao: config.versao ?? "local" },
      messageKey: "mensagem",
      timestamp: () => `,"hora":"${new Date().toISOString()}"`,
      // Sem dado pessoal nem sensível nos registros (M6-02): eles saem do servidor para o destino central.
      formatters: {
        level: (nivel) => ({ nivel }),
        log: (objeto) => limparRegistro(objeto) as Record<string, unknown>,
      },
      // Fora de um pedido (a fila, as rotinas, o Telegram), o número do trabalho entra em cada registro; num pedido,
      // ele já vem do próprio pedido.
      mixin: (_objeto, _nivel, registro) => {
        // O registro do pedido já leva o número (nas "chindings", o texto fixo do registro filho).
        const fixo = textoFixoDoRegistro(registro);
        if (typeof fixo === "string" && fixo.includes('"rastreio":')) return {};
        const rastreio = rastreioAtual();
        return rastreio ? { rastreio } : {};
      },
      hooks: {
        logMethod(argumentos, metodo) {
          metodo.apply(
            this,
            argumentos.map((a) => (typeof a === "string" ? limparTexto(a) : a)) as typeof argumentos,
          );
        },
      },
      serializers: {
        req: (pedido: { method: string; url: string }) => ({
          metodo: pedido.method,
          url: enderecoSemValores(pedido.url),
        }),
      },
      ...(opcoes.destinoDosRegistros ? { stream: opcoes.destinoDosRegistros } : {}),
    },
    logController: new LogController({ requestIdLogLabel: "rastreio" }),
    genReqId: () => numeroDeRastreio(),
  });

  if (opcoes.aoRegistrarRota) app.addHook("onRoute", opcoes.aoRegistrarRota);
  // O número do pedido segue para a fila, os agentes, o Telegram e as rotinas (M6-02). O Fastify lê o corpo do pedido
  // num evento do Node, fora do contexto do onRequest; por isso o contexto é guardado e retomado no preValidation
  // (como faz o @fastify/request-context).
  app.addHook("onRequest", (pedido, resposta, pronto) => {
    resposta.header("x-rastreio", pedido.id);
    comNumeroDeRastreio(pedido.id, () => {
      contextoDoPedido.set(pedido, new AsyncResource("mago-os-pedido"));
      pronto();
    });
  });
  app.addHook("preValidation", (pedido, _resposta, pronto) => {
    const contexto = contextoDoPedido.get(pedido);
    if (contexto) contexto.runInAsyncScope(pronto, pedido.raw);
    else pronto();
  });

  // Erro do sistema (M6-04): a pessoa recebe uma mensagem genérica com o número de rastreio (no cabeçalho), e o
  // detalhe (uma mensagem do banco, por exemplo) fica só no registro. Os erros do pedido (4xx) seguem como estão.
  app.setErrorHandler((erro: { statusCode?: number; code?: string; message?: string }, pedido, resposta) => {
    const status = typeof erro.statusCode === "number" && erro.statusCode >= 400 ? erro.statusCode : 500;
    if (status < 500) return resposta.code(status).send(erro);
    pedido.log.error({ erro }, "Erro do sistema no pedido");
    return resposta
      .code(status)
      .send({ code: "ERRO_INTERNO", message: "Algo deu errado do nosso lado. Tente de novo em instantes." });
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
      versao: config.versao ?? "local",
    };
  });

  return app;
}
