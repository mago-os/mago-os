/**
 * Convite para criar empresa (M1-11).
 *
 * - O Dono da plataforma convida o responsável por uma conta nova (nome e e-mail), vê a lista de contas (só o
 *   cadastro) e reenvia ou cancela os convites pendentes. O Dono não entra nas contas.
 * - O responsável abre o link, cria a senha (ou entra, se já tem conta), preenche os dados da conta (empresa com
 *   CNPJ ou pessoa física com CPF) e vira o administrador dela.
 * Ver docs/decisoes/0016-convite-para-criar-empresa.md.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  conferirPedidoDeConviteDeEmpresa,
  conferirPedidoDeNovaEmpresa,
  normalizarDocumento,
  normalizarEmail,
} from "@mago-os/contratos";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { LIMITE_DOS_CONVITES, limitarPedidos } from "../acesso/limite-de-pedidos.ts";
import type { Carteiro, Login } from "../acesso/login.ts";
import { SENHA_MAXIMA, SENHA_MINIMA } from "../acesso/login.ts";
import { origemDoPedido, type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";

/** O link do convite vale 7 dias, como o de pessoas. */
export const DIAS_DO_CONVITE_DE_EMPRESA = 7;

const impressao = (codigo: string) => createHash("sha256").update(codigo).digest("hex");

export interface OpcoesDasContas {
  login: Login;
  poolAcesso: pg.Pool;
  carteiro: Carteiro;
  urlPublica: string;
  conferirSenhasVazadas: boolean;
}

const INVALIDO = { code: "CONVITE_INVALIDO", message: "Este convite expirou ou já foi usado." };

export function registrarRotasDasContas(app: FastifyInstance, o: OpcoesDasContas): void {
  const { poolAcesso } = o;
  const site = new URL(o.urlPublica).origin;

  /** Só o Dono, com a sessão completa (o 2FA é obrigatório para ele). */
  async function exigirDono(pedido: FastifyRequest, resposta: FastifyReply): Promise<SessaoDoPedido | null> {
    const sessao = await sessaoDoPedido(o.login, poolAcesso, pedido);
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
    const dono = await poolAcesso.query<{ e: boolean }>("select acesso.e_dono_da_plataforma($1) as e", [
      sessao.pessoa.id,
    ]);
    if (dono.rows[0]?.e !== true) {
      resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só o Dono da plataforma." });
      return null;
    }
    return sessao;
  }

  const eventoDaPlataforma = (pedido: FastifyRequest, pessoaId: string, acao: string, conviteId: string) =>
    auditar(
      poolAcesso,
      {
        empresaId: null,
        ator: { tipo: "pessoa", pessoaId },
        acao,
        alvo: { tipo: "convite_de_empresa", id: conviteId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
      },
      pedido.log,
    );

  /** Cria o código (o banco guarda só a impressão digital), troca o convite pendente do mesmo e-mail e manda. */
  async function enviar(nome: string, email: string, quem: { id: string; nome: string }): Promise<string> {
    if (!o.carteiro.enviarConviteDeEmpresa) throw new Error("Convite de empresa: o carteiro não sabe mandar");
    const codigo = randomBytes(32).toString("base64url");
    await poolAcesso.query(
      "update acesso.convites_de_empresa set cancelado_em = now() where email = $1 and usado_em is null and cancelado_em is null",
      [email],
    );
    const r = await poolAcesso.query<{ id: string }>(
      `insert into acesso.convites_de_empresa (nome, email, codigo, convidado_por, expira_em)
         values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id`,
      [nome, email, impressao(codigo), quem.id, DIAS_DO_CONVITE_DE_EMPRESA],
    );
    await o.carteiro.enviarConviteDeEmpresa({
      para: email,
      nome,
      quemConvidou: quem.nome,
      link: `${site}/nova-conta?codigo=${encodeURIComponent(codigo)}`,
    });
    return r.rows[0]?.id as string;
  }

  // Lista para o Dono: as contas (só o cadastro) e os convites ainda pendentes.
  app.get("/plataforma/empresas", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const empresas = await poolAcesso.query<{
      id: string;
      nome: string;
      tipo: "pj" | "pf" | null;
      documento: string | null;
      situacao: string;
      criada_em: Date;
      pessoas: number;
    }>("select * from acesso.empresas_da_plataforma($1)", [sessao.pessoa.id]);
    const convites = await poolAcesso.query<{
      id: string;
      nome: string;
      email: string;
      criado_em: Date;
      expira_em: Date;
    }>(
      `select id, nome, email, criado_em, expira_em from acesso.convites_de_empresa
        where usado_em is null and cancelado_em is null and expira_em > now() order by criado_em desc`,
    );
    return {
      empresas: empresas.rows.map((e) => ({
        id: e.id,
        nome: e.nome,
        tipo: e.tipo,
        documento: e.documento,
        situacao: e.situacao,
        criadaEm: e.criada_em.toISOString(),
        pessoas: e.pessoas,
      })),
      convites: convites.rows.map((c) => ({
        id: c.id,
        nome: c.nome,
        email: c.email,
        criadoEm: c.criado_em.toISOString(),
        expiraEm: c.expira_em.toISOString(),
      })),
    };
  });

  app.post("/plataforma/empresas/convites", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const corpo = (pedido.body ?? {}) as Record<string, unknown>;
    const r = conferirPedidoDeConviteDeEmpresa({
      nome: typeof corpo.nome === "string" ? corpo.nome.trim() : corpo.nome,
      email: typeof corpo.email === "string" ? normalizarEmail(corpo.email) : corpo.email,
    });
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const id = await enviar(r.valor.nome, r.valor.email, sessao.pessoa);
    await eventoDaPlataforma(pedido, sessao.pessoa.id, "empresa.convidou", id);
    return { ok: true, id };
  });

  app.post("/plataforma/empresas/convites/:id/reenviar", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const { id } = pedido.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta.code(404).send(INVALIDO);
    const c = await poolAcesso.query<{ nome: string; email: string }>(
      "select nome, email from acesso.convites_de_empresa where id = $1 and usado_em is null and cancelado_em is null",
      [id],
    );
    const convite = c.rows[0];
    if (!convite)
      return resposta.code(404).send({ code: "CONVITE_NAO_ENCONTRADO", message: "Não há convite pendente." });
    const novo = await enviar(convite.nome, convite.email, sessao.pessoa);
    await eventoDaPlataforma(pedido, sessao.pessoa.id, "empresa.reenviou_convite", novo);
    return { ok: true, id: novo };
  });

  app.post("/plataforma/empresas/convites/:id/cancelar", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const { id } = pedido.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta.code(404).send(INVALIDO);
    const r = await poolAcesso.query(
      "update acesso.convites_de_empresa set cancelado_em = now() where id = $1 and usado_em is null and cancelado_em is null",
      [id],
    );
    if (!r.rowCount)
      return resposta.code(404).send({ code: "CONVITE_NAO_ENCONTRADO", message: "Não há convite pendente." });
    await eventoDaPlataforma(pedido, sessao.pessoa.id, "empresa.cancelou_convite", id);
    return { ok: true };
  });

  // Antes de entrar com o Google pelo link: a pessoa do convite passa a existir, com o e-mail confirmado, para o
  // Google ligar a conta dele a ela (sem cadastro aberto: só o e-mail convidado entra).
  app.post(
    "/acesso/convite-de-empresa/preparar-google",
    { preHandler: limitarPedidos(poolAcesso, LIMITE_DOS_CONVITES) },
    async (pedido, resposta) => {
      const codigo = (pedido.body as { codigo?: unknown } | undefined)?.codigo;
      if (typeof codigo !== "string") return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
      const p = await poolAcesso.query<{ id: string | null }>(
        "select acesso.pessoa_do_convite_de_empresa($1) as id",
        [impressao(codigo)],
      );
      if (!p.rows[0]?.id) return resposta.code(404).send(INVALIDO);
      return { ok: true };
    },
  );

  // Abrir o link (sem login): para a tela mostrar o caminho certo.
  app.get(
    "/acesso/convite-de-empresa/:codigo",
    { preHandler: limitarPedidos(poolAcesso, LIMITE_DOS_CONVITES) },
    async (pedido, resposta) => {
      const { codigo } = pedido.params as { codigo: string };
      const r = await poolAcesso.query<{
        nome: string;
        email: string;
        quem_convidou: string;
        tem_conta: boolean;
        valido: boolean;
      }>("select * from acesso.abrir_convite_de_empresa($1)", [impressao(codigo)]);
      const c = r.rows[0];
      if (!c?.valido) return resposta.code(404).send(INVALIDO);
      return { nome: c.nome, email: c.email, quemConvidou: c.quem_convidou, temConta: c.tem_conta };
    },
  );

  // Criar a conta pelo link. Sem conta: define a senha aqui. Com conta: precisa entrar antes, com o e-mail do convite.
  app.post(
    "/acesso/convite-de-empresa/criar",
    { preHandler: limitarPedidos(poolAcesso, LIMITE_DOS_CONVITES) },
    async (pedido, resposta) => {
      const corpo = (pedido.body ?? {}) as {
        codigo?: unknown;
        senha?: unknown;
        conta?: Record<string, unknown>;
      };
      if (typeof corpo.codigo !== "string" || typeof corpo.conta !== "object" || corpo.conta === null) {
        return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
      }
      const conta = corpo.conta;
      const limpo = (v: unknown) => (typeof v === "string" ? v.trim() || null : (v ?? null));
      const documento =
        typeof conta.documento === "string"
          ? normalizarDocumento(conta.documento) || null
          : (conta.documento ?? null);
      const dados = conferirPedidoDeNovaEmpresa({
        ...conta,
        // Sem documento, o tipo não vale nada: fica vazio também (tipo e documento andam juntos).
        tipo: documento === null ? null : (conta.tipo ?? null),
        documento,
        nome: limpo(conta.nome),
        nomeLegal: limpo(conta.nomeLegal),
        telefone: limpo(conta.telefone),
      });
      if (!dados.ok) {
        const doc = dados.problemas.find((p) => p.caminho === "/documento");
        return resposta.code(400).send({
          code: "PEDIDO_INVALIDO",
          message: doc ? `Confira o documento: ${doc.mensagem}.` : "Confira os dados da conta.",
          problemas: dados.problemas,
        });
      }
      const hash = impressao(corpo.codigo);
      const sessao = await sessaoDoPedido(o.login, poolAcesso, pedido);
      const senha = typeof corpo.senha === "string" ? corpo.senha : "";
      if (!sessao) {
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
      }
      const embaralhada = sessao ? null : await (await o.login.$context).password.hash(senha);

      // Tudo numa transação: se algo falhar, nada fica pela metade (nem a senha).
      const c = await poolAcesso.connect();
      let empresaId: string;
      let pessoaId: string;
      try {
        await c.query("begin");
        const p = await c.query<{ id: string | null }>(
          "select acesso.pessoa_do_convite_de_empresa($1) as id",
          [hash],
        );
        const doConvite = p.rows[0]?.id ?? null;
        if (!doConvite) {
          await c.query("rollback");
          return resposta.code(404).send(INVALIDO);
        }
        if (sessao) {
          pessoaId = sessao.pessoa.id;
        } else {
          const temConta = await c.query("select 1 from acesso.credenciais where pessoa_id = $1", [
            doConvite,
          ]);
          if (temConta.rowCount) {
            await c.query("rollback");
            return resposta.code(401).send({
              code: "ENTRE_ANTES",
              message: "Você já tem conta no Mago OS. Entre para criar a conta nova.",
            });
          }
          await c.query(
            "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
            [doConvite, doConvite, embaralhada],
          );
          pessoaId = doConvite;
        }
        const v = dados.valor;
        const e = await c.query<{ id: string }>(
          "select acesso.criar_empresa_pelo_convite($1, $2, $3, $4, $5, $6, $7, $8, $9) as id",
          [hash, pessoaId, v.tipo, v.documento, v.nomeLegal, v.nome, v.fusoHorario, v.idioma, v.telefone],
        );
        empresaId = e.rows[0]?.id as string;
        await c.query("commit");
      } catch (erro) {
        await c.query("rollback").catch(() => {});
        const texto = String(erro);
        if (/outra pessoa/.test(texto)) {
          return resposta.code(403).send({
            code: "CONVITE_DE_OUTRA_PESSOA",
            message: "Este convite é de outro e-mail. Saia e entre com a conta do e-mail convidado.",
          });
        }
        if (/expirou/.test(texto)) return resposta.code(404).send(INVALIDO);
        throw erro;
      } finally {
        c.release();
      }

      // Quem criou com a sessão aberta já entra trabalhando na conta nova.
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
          acao: "empresa.criou",
          alvo: { tipo: "empresa", id: empresaId },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: { tipo: dados.valor.tipo },
        },
        pedido.log,
      );
      return { ok: true, empresaId, precisaEntrar: !sessao };
    },
  );
}
