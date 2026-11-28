/**
 * Rotas do WhatsApp da plataforma (M8-09, decisão 0059):
 * - GET /whatsapp/webhook: o desafio da Meta, só com o texto de verificação certo.
 * - POST /whatsapp/webhook: a Meta entrega os avisos aqui (pelo Caddy, em /api/whatsapp/webhook). Cada um é conferido
 *   pela assinatura X-Hub-Signature-256 (HMAC SHA-256 do corpo, com a chave secreta do app), em tempo constante; sem
 *   ela, 401 e nada é lido. A resposta é 200 na hora e o trabalho vai para a fila.
 * - GET /conta/whatsapp, POST /conta/whatsapp/codigo e DELETE /conta/whatsapp: Meu perfil › WhatsApp, só para a
 *   própria pessoa, com a sessão completa.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AvisoDaMeta,
  type CodigoDoWhatsapp,
  conferir,
  MINUTOS_DO_CODIGO_DO_TELEGRAM,
  RESPOSTAS_DO_WHATSAPP,
  type SituacaoDoWhatsapp,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Login } from "../acesso/login.ts";
import { origemDoPedido, type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { gerarCodigoDoTelegram, resumoDoCodigo } from "../telegram/servico.ts";
import type { CarteiroDaMeta } from "./carteiro.ts";

export interface MetaLigada {
  carteiro: CarteiroDaMeta;
  /** A chave secreta do app (confere a assinatura). */
  segredoDoApp: string;
  /** O texto de verificação do webhook (o desafio da Meta). */
  verificacao: string;
}

export interface OpcoesDasRotasDoWhatsapp {
  login: Login;
  poolAcesso: pg.Pool;
  poolApp: pg.Pool;
  /** Nulo: o WhatsApp da plataforma está desligado neste ambiente (sem os segredos). */
  meta: MetaLigada | null;
  /** Leva o aviso à fila (na API) ou trata na hora (nos testes). */
  receber: (a: AvisoDaMeta) => Promise<void>;
}

function mesmo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A assinatura da Meta: "sha256=" e o HMAC SHA-256 do corpo cru, em hexadecimal. */
export function assinaturaDaMeta(corpo: Buffer, segredoDoApp: string): string {
  return `sha256=${createHmac("sha256", segredoDoApp).update(corpo).digest("hex")}`;
}

export function registrarRotasDoWhatsapp(app: FastifyInstance, o: OpcoesDasRotasDoWhatsapp): void {
  const meta = o.meta;
  if (meta) {
    app.get("/whatsapp/webhook", async (pedido, resposta) => {
      const q = pedido.query as Record<string, string | undefined>;
      if (q["hub.mode"] !== "subscribe" || !mesmo(q["hub.verify_token"] ?? "", meta.verificacao))
        return resposta.code(403).send({ code: "SEM_VERIFICACAO" });
      return resposta
        .header("content-type", "text/plain")
        .send(String(q["hub.challenge"] ?? "").slice(0, 200));
    });
    // O corpo cru é o que a assinatura cobre: este endereço lê o JSON só depois de conferir.
    app.register(async (escopo) => {
      escopo.addContentTypeParser(
        "application/json",
        { parseAs: "buffer", bodyLimit: 1024 * 1024 },
        (_p, corpo, pronto) => pronto(null, corpo),
      );
      escopo.post("/whatsapp/webhook", async (pedido, resposta) => {
        const corpo = pedido.body as Buffer;
        const assinatura = pedido.headers["x-hub-signature-256"];
        if (
          !Buffer.isBuffer(corpo) ||
          typeof assinatura !== "string" ||
          !mesmo(assinatura, assinaturaDaMeta(corpo, meta.segredoDoApp))
        )
          return resposta.code(401).send({ code: "SEM_ASSINATURA" });
        let json: unknown;
        try {
          json = JSON.parse(corpo.toString("utf8"));
        } catch {
          return { ok: true };
        }
        const r = conferir(AvisoDaMeta, json);
        // Formato desconhecido (outro campo, um aviso de entrega): 200 mesmo assim, senão a Meta repete.
        if (!r.ok) return { ok: true };
        await o.receber(r.valor);
        return { ok: true };
      });
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

  app.get("/conta/whatsapp", async (pedido, resposta): Promise<SituacaoDoWhatsapp | FastifyReply> => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const v = await comPessoa(o.poolApp, sessao.pessoa.id, null, async (c) => {
      const r = await c.query<{
        numero: string;
        nome: string;
        empresa_id: string;
        empresa_nome: string;
        vinculado_em: Date;
      }>(
        `select w.numero, w.nome, w.empresa_id, e.nome as empresa_nome, w.vinculado_em
           from vinculos_do_whatsapp w join empresas e on e.id = w.empresa_id where w.pessoa_id = pessoa_ativa()`,
      );
      return r.rows[0] ?? null;
    });
    return {
      ligado: meta !== null && meta.carteiro.numero !== "",
      vinculo: v
        ? {
            finalDoNumero: v.numero.slice(-4),
            nome: v.nome,
            empresa: { id: v.empresa_id, nome: v.empresa_nome },
            vinculadoEm: v.vinculado_em.toISOString(),
          }
        : null,
    };
  });

  app.post("/conta/whatsapp/codigo", async (pedido, resposta): Promise<CodigoDoWhatsapp | FastifyReply> => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    if (!meta)
      return resposta.code(409).send({
        code: "WHATSAPP_DESLIGADO",
        message: "O WhatsApp do Mago OS não está ligado neste ambiente.",
      });
    if (!sessao.empresaId)
      return resposta
        .code(409)
        .send({ code: "SEM_EMPRESA", message: "Escolha a empresa antes de vincular o WhatsApp." });
    const codigo = gerarCodigoDoTelegram();
    const venceEm = new Date(Date.now() + MINUTOS_DO_CODIGO_DO_TELEGRAM * 60_000);
    const ok = await comPessoa(o.poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const e = await c.query<{ e: string | null }>("select empresa_ativa() as e");
      if (!e.rows[0]?.e) return false;
      await c.query("select pg_advisory_xact_lock(hashtextextended('whatsapp:' || pessoa_ativa()::text, 0))");
      await c.query(
        "update codigos_do_whatsapp set usado_em = now() where pessoa_id = pessoa_ativa() and usado_em is null",
      );
      await c.query(
        `insert into codigos_do_whatsapp (empresa_id, pessoa_id, resumo, vence_em)
         values (empresa_ativa(), pessoa_ativa(), $1, $2)`,
        [resumoDoCodigo(codigo), venceEm],
      );
      return true;
    });
    if (!ok)
      return resposta.code(403).send({ code: "SEM_VINCULO", message: "Você não tem acesso a essa empresa." });
    return {
      codigo,
      link: `https://wa.me/${meta.carteiro.numero}?text=${codigo}`,
      venceEm: venceEm.toISOString(),
    };
  });

  app.delete("/conta/whatsapp", async (pedido, resposta) => {
    const sessao = await exigirCompleta(pedido, resposta);
    if (!sessao) return resposta;
    const apagado = await comPessoa(o.poolApp, sessao.pessoa.id, null, async (c) => {
      const r = await c.query<{ empresa_id: string; numero: string }>(
        "delete from vinculos_do_whatsapp where pessoa_id = pessoa_ativa() returning empresa_id, numero",
      );
      return r.rows[0] ?? null;
    });
    if (!apagado) return { ok: true };
    await auditar(
      o.poolApp,
      {
        empresaId: apagado.empresa_id,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "whatsapp.desvinculou",
        alvo: { tipo: "pessoa", id: sessao.pessoa.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { motivo: "pessoa" },
      },
      pedido.log,
    );
    await meta?.carteiro
      .enviarTexto(apagado.numero, RESPOSTAS_DO_WHATSAPP.desvinculado)
      .catch((erro) =>
        pedido.log.warn({ erro: (erro as Error).message }, "WhatsApp: aviso de desvínculo não foi"),
      );
    return { ok: true };
  });
}
