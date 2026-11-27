/**
 * A API inteira, montada como no servidor (montarApi), com o banco temporário e o que fala com fora trocado por
 * falsos: Telegram, modelos e provedores de IA, e-mail no registro, anexos numa pasta. Usado pelo teste de vazamento
 * (M6-01), que precisa de todas as rotas.
 */
import { randomBytes } from "node:crypto";
import { criarPoolDoLogin } from "@mago-os/nucleo/acesso";
import type { BancoTemporario } from "@mago-os/nucleo/banco-temporario";
import type { Config } from "@mago-os/nucleo/config";
import { type modelosFalsos, provedoresFalsos } from "@mago-os/nucleo/contas-de-ia";
import { type EvolutionFalsa, evolutionFalsa } from "@mago-os/nucleo/conversas";
import { montarApi } from "@mago-os/nucleo/montar";
import { carteiroFalsoDoTelegram } from "@mago-os/nucleo/telegram";
import type { FastifyInstance, RouteOptions } from "fastify";
import pg from "pg";

export const SITE = "https://teste.osmago.invalid";
export const SEGREDO_DO_WEBHOOK = "segredo-do-webhook-de-teste-com-32-ou-mais";
export const SEGREDO_DA_EVOLUTION = "segredo-dos-avisos-da-evolution-de-teste-32";
export const CHAVE_DE_IA = "sk-ant-api03-chave-do-vazamento-Vz01";
export const TOKEN_DO_PLANO = "sk-ant-oat01-token-do-plano-do-vazamento-Vz02";

export interface ApiDeTeste {
  app: FastifyInstance;
  rotas: { metodo: string; url: string }[];
  poolApp: pg.Pool;
  poolAcesso: pg.Pool;
  carteiro: ReturnType<typeof carteiroFalsoDoTelegram>;
  /** Trabalhos que a API mandou para a fila (execuções dos agentes, anexos, Telegram). */
  enviados: { fila: string; dados: unknown }[];
  /** E-mails que a API mandou (cada chamada ao carteiro, com os argumentos). */
  emails: { tipo: string; argumentos: unknown[] }[];
  interno: NonNullable<Awaited<ReturnType<typeof montarApi>>["interno"]>;
  /** Os avisos dos webhooks que a API mandou (M7-03): o envio é falso e responde o que o teste quiser. */
  webhooks: { url: string; cabecalhos: Record<string, string>; corpo: string }[];
  /** O código que o envio falso responde (padrão 200; nulo: sem resposta). */
  respostaDosWebhooks: { codigo: number | null };
  /** A Evolution falsa (M8-02): os canais de WhatsApp conectam e caem quando o teste manda. */
  evolution: EvolutionFalsa;
  fechar(): Promise<void>;
}

export async function montarApiDeTeste(
  banco: BancoTemporario,
  opcoes: { modelos: ReturnType<typeof modelosFalsos> },
): Promise<ApiDeTeste> {
  const poolApp = new pg.Pool({ connectionString: banco.urlApp });
  const poolAcesso = criarPoolDoLogin(banco.urlAcesso);
  const carteiro = carteiroFalsoDoTelegram();
  // O bot liga num trabalho que não espera (como no servidor): o teste espera o fim dele (o menu de comandos).
  let botLigou: () => void = () => {};
  const ligado = new Promise<void>((r) => {
    botLigou = r;
  });
  carteiro.definirComandos = async () => botLigou();
  const enviados: { fila: string; dados: unknown }[] = [];
  const evolution = evolutionFalsa();
  const rotas: { metodo: string; url: string }[] = [];
  const emails: { tipo: string; argumentos: unknown[] }[] = [];
  const webhooks: { url: string; cabecalhos: Record<string, string>; corpo: string }[] = [];
  const respostaDosWebhooks: { codigo: number | null } = { codigo: 200 };
  const carteiroDeEmail = new Proxy(
    {},
    {
      get:
        (_alvo, tipo) =>
        async (...argumentos: unknown[]) => {
          emails.push({ tipo: String(tipo), argumentos });
        },
    },
  ) as NonNullable<Parameters<typeof montarApi>[1]["carteiroDeEmail"]>;
  const config: Config = {
    porta: 0,
    host: "127.0.0.1",
    bancoUrl: banco.urlApp,
    nivelRegistro: "silent",
    ambiente: "local",
    versao: "teste",
    acesso: {
      bancoUrl: banco.urlAcesso,
      segredo: "segredo-de-teste-com-mais-de-32-caracteres-vz",
      urlPublica: SITE,
      conferirSenhasVazadas: false,
      resend: null,
      google: null,
      // Só a chave pública vai para as rotas; o envio de verdade fica nos trabalhos (o teste usa um falso).
      vapid: {
        publica: "chave-publica-de-teste",
        privada: "nao-usada",
        assunto: "mailto:teste@teste.invalid",
      },
    },
    anexos: { deposito: { tipo: "disco" }, clamav: null },
    cofre: { atual: { versao: 1, chave: randomBytes(32) }, anteriores: [], deTeste: true },
    telegram: { token: "123:token-falso", segredo: SEGREDO_DO_WEBHOOK },
    evolution: {
      url: "http://evolution.invalid:8080",
      chave: "chave-falsa-da-evolution-de-teste",
      segredo: SEGREDO_DA_EVOLUTION,
      urlDosAvisos: "http://api.invalid:3000/interno/evolution/avisos",
    },
  };
  const fila = {
    async send(nome: string, dados?: unknown) {
      enviados.push({ fila: nome, dados });
      return null;
    },
    async createQueue() {},
    async schedule() {},
    async work() {
      return "";
    },
  } as unknown as Parameters<typeof montarApi>[1]["fila"];
  const banco_ = {
    pool: poolApp,
    async estaSaudavel() {
      return true;
    },
    async fechar() {},
  };
  const { app, interno, trabalhos } = await montarApi(config, {
    banco: banco_,
    fila,
    poolDoLogin: poolAcesso,
    carteiroDoTelegram: () => carteiro,
    carteiroDeEmail,
    modelos: opcoes.modelos,
    provedores: provedoresFalsos({ [CHAVE_DE_IA]: ["modelo-bom"], [TOKEN_DO_PLANO]: ["modelo-bom"] }),
    semRelogioDosWebhooks: true,
    evolution,
    enviarWebhook: async (url, cabecalhos, corpo) => {
      webhooks.push({ url, cabecalhos, corpo });
      const codigo = respostaDosWebhooks.codigo;
      return { codigo, erro: codigo === 200 ? null : "O endereço não respondeu.", ms: 3 };
    },
    aoRegistrarRota: (r: RouteOptions) => {
      const metodos = ([] as string[]).concat(r.method);
      for (const m of metodos) if (m !== "HEAD") rotas.push({ metodo: m, url: r.url });
    },
  });
  await app.ready();
  // Os trabalhos se registram na fila falsa (que não roda nada); o do Telegram também liga o bot no carteiro falso.
  for (const ligar of trabalhos) await ligar();
  await ligado;
  if (!interno) throw new Error("A API de teste precisa do login ligado");
  return {
    evolution,
    app,
    rotas,
    poolApp,
    poolAcesso,
    carteiro,
    enviados,
    emails,
    interno,
    webhooks,
    respostaDosWebhooks,
    async fechar() {
      await app.close();
      await poolApp.end();
      await poolAcesso.end();
    },
  };
}
