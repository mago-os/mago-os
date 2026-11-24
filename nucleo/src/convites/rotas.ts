/**
 * Convites e desligamento (M1-07).
 *
 * - O administrador convida (permissão pessoas.criar), reenvia ou cancela; e desliga (pessoas.excluir).
 * - O convidado abre o link (sem login), e aceita: quem ainda não tem conta define a senha ali mesmo; quem já tem
 *   entra antes (com senha, passkey ou o Google do mesmo e-mail) e aceita.
 * - Desligar corta o acesso à empresa na hora: o banco deixa de mostrar a empresa, e as sessões saem dela (ou são
 *   encerradas, se a pessoa não tem outra empresa).
 * Ver docs/decisoes/0015-convites.md.
 */

import { createHash, randomBytes } from "node:crypto";
import { conferirPedidoDeConvite, normalizarEmail } from "@mago-os/contratos";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { LIMITE_DOS_CONVITES, limitarPedidos } from "../acesso/limite-de-pedidos.ts";
import type { Carteiro, Login } from "../acesso/login.ts";
import { SENHA_MAXIMA, SENHA_MINIMA } from "../acesso/login.ts";
import { origemDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";

/** O link do convite vale 7 dias. */
export const DIAS_DO_CONVITE = 7;
/** Cada pessoa manda no máximo 30 convites por hora (ninguém usa o sistema para mandar spam). */
export const CONVITES_POR_HORA = 30;

const impressao = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

export interface OpcoesDosConvites {
  login: Login;
  verificador: Verificador;
  poolApp: pg.Pool;
  poolAcesso: pg.Pool;
  carteiro: Carteiro;
  urlPublica: string;
  conferirSenhasVazadas: boolean;
}

export function registrarRotasDosConvites(app: FastifyInstance, o: OpcoesDosConvites): void {
  const { verificador, poolApp, poolAcesso } = o;
  const site = new URL(o.urlPublica).origin;

  /** Quem é convidado e para qual empresa (do jeito que está no banco), para o e-mail. */
  async function dadosDoVinculo(pessoaId: string, empresaId: string, vinculoId: string) {
    return comPessoa(poolApp, pessoaId, empresaId, async (c) => {
      const q = await c.query<{ pessoa_id: string; email: string; nome: string; empresa: string }>(
        `select v.pessoa_id, p.email, p.nome, e.nome as empresa
           from vinculos v join pessoas p on p.id = v.pessoa_id join empresas e on e.id = v.empresa_id
          where v.id = $1 and v.empresa_id = empresa_ativa() and v.situacao = 'convidado'`,
        [vinculoId],
      );
      return q.rows[0];
    });
  }

  /** Cria o código do link (o banco guarda só a impressão digital), troca o convite anterior e manda o e-mail. */
  async function enviarConvite(
    empresaId: string,
    vinculoId: string,
    quem: { id: string; nome: string },
    para: { pessoa_id: string; email: string; nome: string; empresa: string },
  ) {
    if (!o.carteiro.enviarConvite) throw new Error("Convite: o carteiro não sabe mandar convites");
    const codigo = randomBytes(32).toString("base64url");
    await poolAcesso.query(
      "update acesso.convites set cancelado_em = now() where vinculo_id = $1 and usado_em is null and cancelado_em is null",
      [vinculoId],
    );
    await poolAcesso.query(
      `insert into acesso.convites (empresa_id, vinculo_id, pessoa_id, codigo, convidado_por, expira_em)
         values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
      [empresaId, vinculoId, para.pessoa_id, impressao(codigo), quem.id, DIAS_DO_CONVITE],
    );
    await o.carteiro.enviarConvite({
      para: para.email,
      nome: para.nome,
      empresa: para.empresa,
      quemConvidou: quem.nome,
      link: `${site}/convite?codigo=${encodeURIComponent(codigo)}`,
    });
  }

  async function passouDoLimite(pessoaId: string): Promise<boolean> {
    const r = await poolAcesso.query<{ n: number }>(
      "select count(*)::int as n from acesso.convites where convidado_por = $1 and criado_em > now() - interval '1 hour'",
      [pessoaId],
    );
    return (r.rows[0]?.n ?? 0) >= CONVITES_POR_HORA;
  }

  const evento = (
    pedido: FastifyRequest,
    empresaId: string,
    pessoaId: string,
    acao: string,
    alvo: string,
    detalhes = {},
  ) =>
    auditar(
      poolApp,
      {
        empresaId,
        ator: { tipo: "pessoa", pessoaId },
        acao,
        alvo: { tipo: "vinculo", id: alvo },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );

  app.post(
    "/empresa/convites",
    { preHandler: verificador.exigir("pessoas", "criar") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const corpo = (pedido.body ?? {}) as Record<string, unknown>;
      const r = conferirPedidoDeConvite({
        ...corpo,
        email: typeof corpo.email === "string" ? normalizarEmail(corpo.email) : corpo.email,
        nome: typeof corpo.nome === "string" ? corpo.nome.trim() : corpo.nome,
        area: corpo.area === "" || corpo.area === undefined ? null : corpo.area,
      });
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      if (await passouDoLimite(sessao.pessoa.id)) {
        return resposta.code(429).send({
          code: "CONVITES_DEMAIS",
          message: "Muitos convites em pouco tempo. Tente de novo em uma hora.",
        });
      }
      const { email, nome, perfil, area } = r.valor;
      let criado: { pessoa_id: string; vinculo_id: string } | undefined;
      try {
        criado = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
          const q = await c.query<{ pessoa_id: string; vinculo_id: string }>(
            "select * from convidar($1, $2, $3, $4)",
            [email, nome, perfil, area],
          );
          return q.rows[0];
        });
      } catch (erro) {
        if (/já está na empresa/.test(String(erro))) {
          return resposta.code(409).send({
            code: "JA_ESTA_NA_EMPRESA",
            message: "Essa pessoa já está na empresa ou já foi convidada.",
          });
        }
        throw erro;
      }
      if (!criado) throw new Error("Convite: nada foi criado");
      const para = await dadosDoVinculo(sessao.pessoa.id, sessao.empresaId, criado.vinculo_id);
      if (!para) throw new Error("Convite: o vínculo criado não aparece");
      await enviarConvite(sessao.empresaId, criado.vinculo_id, sessao.pessoa, para);
      await evento(pedido, sessao.empresaId, sessao.pessoa.id, "vinculo.convidou", criado.vinculo_id, {
        perfil,
        area,
      });
      return { ok: true, vinculoId: criado.vinculo_id };
    },
  );

  app.post(
    "/empresa/convites/:vinculoId/reenviar",
    { preHandler: verificador.exigir("pessoas", "criar") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const { vinculoId } = pedido.params as { vinculoId: string };
      if (await passouDoLimite(sessao.pessoa.id)) {
        return resposta.code(429).send({
          code: "CONVITES_DEMAIS",
          message: "Muitos convites em pouco tempo. Tente de novo em uma hora.",
        });
      }
      const para = await dadosDoVinculo(sessao.pessoa.id, sessao.empresaId, vinculoId).catch(() => undefined);
      if (!para)
        return resposta
          .code(404)
          .send({ code: "CONVITE_NAO_ENCONTRADO", message: "Não há convite pendente para essa pessoa." });
      await enviarConvite(sessao.empresaId, vinculoId, sessao.pessoa, para);
      await evento(pedido, sessao.empresaId, sessao.pessoa.id, "vinculo.reenviou_convite", vinculoId);
      return { ok: true };
    },
  );

  app.post(
    "/empresa/convites/:vinculoId/cancelar",
    { preHandler: verificador.exigir("pessoas", "criar") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const { vinculoId } = pedido.params as { vinculoId: string };
      try {
        await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
          c.query("select cancelar_convite($1)", [vinculoId]),
        );
      } catch {
        return resposta
          .code(404)
          .send({ code: "CONVITE_NAO_ENCONTRADO", message: "Não há convite pendente para essa pessoa." });
      }
      await evento(pedido, sessao.empresaId, sessao.pessoa.id, "vinculo.cancelou_convite", vinculoId);
      return { ok: true };
    },
  );

  app.post(
    "/empresa/pessoas/:vinculoId/desligar",
    { preHandler: verificador.exigir("pessoas", "excluir") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const { vinculoId } = pedido.params as { vinculoId: string };
      let resultado: { aindaTemEmpresa: boolean; pessoaId: string };
      try {
        resultado = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
          const alvo = await c.query<{ pessoa_id: string }>(
            "select pessoa_id from vinculos where id = $1 and empresa_id = empresa_ativa()",
            [vinculoId],
          );
          const q = await c.query<{ outra: boolean }>("select desligar_vinculo($1, $2) as outra", [
            vinculoId,
            sessao.pessoa.id,
          ]);
          return { aindaTemEmpresa: q.rows[0]?.outra ?? false, pessoaId: alvo.rows[0]?.pessoa_id as string };
        });
      } catch (erro) {
        const texto = String(erro);
        const message = /a si mesmo/.test(texto)
          ? "Você não pode desligar a si mesmo."
          : /sem administrador/.test(texto)
            ? "A empresa não pode ficar sem administrador. Promova outra pessoa antes."
            : "Essa pessoa não está ativa nesta empresa.";
        return resposta.code(400).send({ code: "NAO_PODE_DESLIGAR", message });
      }
      // Corta na hora: sem outra empresa, todas as sessões saem; com outra, as sessões só deixam esta empresa.
      if (resultado.aindaTemEmpresa) {
        await poolAcesso.query(
          "update acesso.sessoes set empresa_id = null where pessoa_id = $1 and empresa_id = $2",
          [resultado.pessoaId, sessao.empresaId],
        );
      } else {
        await poolAcesso.query("delete from acesso.sessoes where pessoa_id = $1", [resultado.pessoaId]);
      }
      await evento(pedido, sessao.empresaId, sessao.pessoa.id, "vinculo.desligou", vinculoId);
      return { ok: true };
    },
  );

  // Abrir o convite (sem login): para a tela mostrar a empresa e o caminho certo.
  app.get(
    "/acesso/convite/:codigo",
    { preHandler: limitarPedidos(poolAcesso, LIMITE_DOS_CONVITES) },
    async (pedido, resposta) => {
      const { codigo } = pedido.params as { codigo: string };
      const r = await poolAcesso.query<{
        empresa: string;
        email: string;
        nome: string;
        quem_convidou: string;
        tem_conta: boolean;
        valido: boolean;
      }>("select * from acesso.abrir_convite($1)", [impressao(codigo)]);
      const c = r.rows[0];
      if (!c?.valido)
        return resposta
          .code(404)
          .send({ code: "CONVITE_INVALIDO", message: "Este convite expirou ou já foi usado." });
      return {
        empresa: c.empresa,
        email: c.email,
        nome: c.nome,
        quemConvidou: c.quem_convidou,
        temConta: c.tem_conta,
      };
    },
  );

  // Aceitar. Com sessão: a pessoa da sessão precisa ser a do convite. Sem conta: define a senha e aceita.
  app.post(
    "/acesso/convite/aceitar",
    { preHandler: limitarPedidos(poolAcesso, LIMITE_DOS_CONVITES) },
    async (pedido, resposta) => {
      const corpo = (pedido.body ?? {}) as { codigo?: unknown; senha?: unknown };
      if (typeof corpo.codigo !== "string") return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
      const hash = impressao(corpo.codigo);
      const sessao = await sessaoDoPedido(o.login, poolAcesso, pedido);
      let pessoaId: string | null = sessao?.pessoa.id ?? null;

      if (!pessoaId) {
        // Sem login: só para quem ainda não tem conta, definindo a senha agora.
        const p = await poolAcesso.query<{ id: string | null }>("select acesso.pessoa_do_convite($1) as id", [
          hash,
        ]);
        pessoaId = p.rows[0]?.id ?? null;
        if (!pessoaId)
          return resposta
            .code(404)
            .send({ code: "CONVITE_INVALIDO", message: "Este convite expirou ou já foi usado." });
        const conta = await poolAcesso.query("select 1 from acesso.credenciais where pessoa_id = $1", [
          pessoaId,
        ]);
        if ((conta.rowCount ?? 0) > 0) {
          return resposta.code(401).send({
            code: "ENTRE_ANTES",
            message: "Você já tem conta no Mago OS. Entre para aceitar o convite.",
          });
        }
        const senha = typeof corpo.senha === "string" ? corpo.senha : "";
        if (senha.length < SENHA_MINIMA || senha.length > SENHA_MAXIMA) {
          return resposta
            .code(400)
            .send({ code: "PASSWORD_TOO_SHORT", message: "A senha precisa ter pelo menos 10 caracteres." });
        }
        if (o.conferirSenhasVazadas && (await isPasswordCompromised(senha).catch(() => false))) {
          return resposta.code(400).send({
            code: "PASSWORD_COMPROMISED",
            message:
              "Essa senha já apareceu em vazamentos na internet. Escolha outra, de preferência uma frase longa.",
          });
        }
        const contexto = await o.login.$context;
        await poolAcesso.query(
          "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
          [pessoaId, pessoaId, await contexto.password.hash(senha)],
        );
      }

      let empresaId: string;
      try {
        const a = await poolAcesso.query<{ empresa: string }>(
          "select acesso.aceitar_convite($1, $2) as empresa",
          [hash, pessoaId],
        );
        empresaId = a.rows[0]?.empresa as string;
      } catch (erro) {
        const outra = /outra pessoa/.test(String(erro));
        return resposta.code(outra ? 403 : 404).send({
          code: outra ? "CONVITE_DE_OUTRA_PESSOA" : "CONVITE_INVALIDO",
          message: outra
            ? "Este convite é de outro e-mail. Saia e entre com a conta do e-mail convidado."
            : "Este convite expirou ou já foi usado.",
        });
      }
      // Quem aceitou com a sessão aberta já entra trabalhando na empresa nova.
      if (sessao)
        await poolAcesso.query("update acesso.sessoes set empresa_id = $2 where id = $1", [
          sessao.sessaoId,
          empresaId,
        ]);
      await auditar(
        poolAcesso,
        {
          empresaId,
          ator: { tipo: "pessoa", pessoaId },
          acao: "vinculo.aceitou",
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
        },
        pedido.log,
      );
      return { ok: true, precisaEntrar: !sessao };
    },
  );
}
