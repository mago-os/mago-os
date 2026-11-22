/**
 * Rotas do Telegram (M5-01, decisão 0032):
 * - POST /telegram/webhook: o Telegram entrega cada atualização aqui (pelo Caddy, em /api/telegram/webhook).
 *   Sem o segredo certo no cabeçalho, 401 e nada é lido. A resposta é 200 na hora e o trabalho vai para a fila.
 * - GET /conta/telegram, POST /conta/telegram/codigo e DELETE /conta/telegram: Meu perfil › Telegram, só para a
 *   própria pessoa, com a sessão completa.
 */
import { timingSafeEqual } from "node:crypto";
import {
  AtualizacaoDoTelegram,
  type CodigoDoTelegram,
  conferir,
  MINUTOS_DO_CODIGO_DO_TELEGRAM,
  RESPOSTAS_DO_TELEGRAM,
  type SituacaoDoTelegram,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Login } from "../acesso/login.ts";
import { origemDoPedido, type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import type { CarteiroDoTelegram } from "./carteiro.ts";
import { gerarCodigoDoTelegram, resumoDoCodigo } from "./servico.ts";

export interface BotLigado {
  carteiro: CarteiroDoTelegram;
  segredo: string;
  /** O @ do bot, descoberto ao subir (getMe). Nulo enquanto não respondeu. */
  usuario: () => string | null;
}

export interface OpcoesDasRotasDoTelegram {
  login: Login;
  poolAcesso: pg.Pool;
  poolApp: pg.Pool;
  /** Nulo: o Telegram está desligado neste ambiente (sem o token). */
  bot: BotLigado | null;
  /** Leva a atualização à fila (na API) ou trata na hora (nos testes). */
  receber: (a: AtualizacaoDoTelegram) => Promise<void>;
}

function mesmoSegredo(recebido: unknown, esperado: string): boolean {
  if (typeof recebido !== "string") return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registrarRotasDoTelegram(app: FastifyInstance, o: OpcoesDasRotasDoTelegram): void {
  if (o.bot) {
    const bot = o.bot;
    app.post("/telegram/webhook", { bodyLimit: 256 * 1024 }, async (pedido, resposta) => {
      if (!mesmoSegredo(pedido.headers["x-telegram-bot-api-secret-token"], bot.segredo))
        return resposta.code(401).send({ code: "SEM_SEGREDO" });
      const r = conferir(AtualizacaoDoTelegram, pedido.body);
      // Formato desconhecido: 200 mesmo assim, senão o Telegram manda de novo para sempre.
      if (!r.ok) return { ok: true };
      const nova = await o.poolApp.query<{ nova: boolean }>(
        "select atualizacao_nova_do_telegram($1) as nova",
        [r.valor.update_id],
      );
      if (nova.rows[0]?.nova) await o.receber(r.valor);
      return { ok: true };
    });
  }

  const exigirCompleta = async (
    pedido: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<SessaoDoPedido | null> => {
    const sessao = await sessaoDoPedido(o.login, o.poolAcesso, pedido);
    if (!sessao) {
      resposta.code(401).send({ code: "SEM_SESSAO", message: "Entre no Mago OS para continuar." });
      return null;
    }
    if (!sessao.estado.completa) {
      resposta
        .code(403)
        .send({ code: "DOIS_FATORES_CONFIRMAR", message: "Confirme a autenticação em 2 fatores." });
      return null;
    }
    return sessao;
  };

  async function vinculoDe(pessoaId: string) {
    return comPessoa(o.poolApp, pessoaId, null, async (c) => {
      const r = await c.query<{
        usuario: string | null;
        nome: string;
        empresa_id: string;
        empresa_nome: string;
        chat_id: string;
        vinculado_em: Date;
      }>(
        `select t.usuario, t.nome, t.empresa_id, e.nome as empresa_nome, t.chat_id, t.vinculado_em
           from vinculos_do_telegram t join empresas e on e.id = t.empresa_id
          where t.pessoa_id = pessoa_ativa()`,
      );
      return r.rows[0] ?? null;
    });
  }

  app.get("/conta/telegram", async (pedido, resposta): Promise<SituacaoDoTelegram | FastifyReply> => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const v = await vinculoDe(sessao.pessoa.id);
    return {
      botLigado: o.bot !== null && o.bot.usuario() !== null,
      bot: o.bot?.usuario() ?? null,
      vinculo: v
        ? {
            usuario: v.usuario,
            nome: v.nome,
            empresa: { id: v.empresa_id, nome: v.empresa_nome },
            vinculadoEm: v.vinculado_em.toISOString(),
          }
        : null,
    };
  });

  app.post("/conta/telegram/codigo", async (pedido, resposta): Promise<CodigoDoTelegram | FastifyReply> => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const usuarioDoBot = o.bot?.usuario() ?? null;
    if (!usuarioDoBot)
      return resposta
        .code(409)
        .send({ code: "TELEGRAM_DESLIGADO", message: "O Telegram não está ligado neste ambiente." });
    if (!sessao.empresaId)
      return resposta
        .code(409)
        .send({ code: "SEM_EMPRESA", message: "Escolha a empresa antes de vincular o Telegram." });
    const codigo = gerarCodigoDoTelegram();
    const venceEm = new Date(Date.now() + MINUTOS_DO_CODIGO_DO_TELEGRAM * 60_000);
    const ok = await comPessoa(o.poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const e = await c.query<{ e: string | null }>("select empresa_ativa() as e");
      if (!e.rows[0]?.e) return false;
      // Um código aberto por pessoa: o anterior deixa de valer.
      await c.query(
        "update codigos_do_telegram set usado_em = now() where pessoa_id = pessoa_ativa() and usado_em is null",
      );
      await c.query(
        `insert into codigos_do_telegram (empresa_id, pessoa_id, resumo, vence_em)
         values (empresa_ativa(), pessoa_ativa(), $1, $2)`,
        [resumoDoCodigo(codigo), venceEm],
      );
      return true;
    });
    if (!ok)
      return resposta.code(403).send({ code: "SEM_VINCULO", message: "Você não tem acesso a essa empresa." });
    return { codigo, link: `https://t.me/${usuarioDoBot}?start=${codigo}`, venceEm: venceEm.toISOString() };
  });

  app.delete("/conta/telegram", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const apagado = await comPessoa(o.poolApp, sessao.pessoa.id, null, async (c) => {
      const r = await c.query<{ empresa_id: string; chat_id: string }>(
        "delete from vinculos_do_telegram where pessoa_id = pessoa_ativa() returning empresa_id, chat_id",
      );
      return r.rows[0] ?? null;
    });
    if (!apagado) return { ok: true };
    await auditar(
      o.poolApp,
      {
        empresaId: apagado.empresa_id,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "telegram.desvinculou",
        alvo: { tipo: "pessoa", id: sessao.pessoa.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { motivo: "pessoa" },
      },
      pedido.log,
    );
    await o.bot?.carteiro
      .enviar(Number(apagado.chat_id), RESPOSTAS_DO_TELEGRAM.desvinculado)
      .catch((erro) => pedido.log.warn({ erro }, "Telegram: aviso de desvínculo não foi enviado"));
    return { ok: true };
  });
}
