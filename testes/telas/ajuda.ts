/**
 * Ajuda dos testes de tela: cria uma pessoa falsa com senha (e, se pedido, um vínculo numa empresa falsa) e entra.
 * Tudo com o domínio .invalid, que nunca existe na internet.
 */
import { randomUUID } from "node:crypto";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";

export const SENHA = "uma frase longa para os testes de tela";

export interface PessoaDeTeste {
  email: string;
  nome: string;
  empresaId: string | null;
  limpar(): Promise<void>;
}

export async function criarPessoaDeTeste(
  rotulo: string,
  opcoes: {
    nome?: string;
    perfil?: "administrador" | "gestor_area" | "funcionario";
    area?: string;
    /** Põe a pessoa numa empresa que já existe, em vez de criar uma nova. */
    empresaId?: string;
  } = {},
): Promise<PessoaDeTeste> {
  const nome = opcoes.nome ?? "Pessoa Teste";
  const email = `${rotulo}-${randomUUID().slice(0, 8)}@teste.invalid`;
  const dono = new pg.Client({ connectionString: BANCO_DONO });
  await dono.connect();
  const p = await dono.query<{ id: string }>(
    "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
    [nome, email],
  );
  const id = p.rows[0]?.id as string;
  await dono.query(
    "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
    [id, id, await embaralharSenha(SENHA)],
  );
  let empresaId: string | null = opcoes.empresaId ?? null;
  const criouEmpresa = opcoes.perfil !== undefined && !opcoes.empresaId;
  if (opcoes.perfil) {
    if (!empresaId) {
      const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
        `Empresa ${email}`,
      ]);
      empresaId = e.rows[0]?.id ?? null;
    }
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now())`,
      [empresaId, id, opcoes.perfil, opcoes.area ?? null],
    );
  }
  await dono.end();
  return {
    email,
    nome,
    empresaId,
    async limpar() {
      const c = new pg.Client({ connectionString: BANCO_DONO });
      await c.connect();
      await c.query("delete from acesso.travas where email = $1", [email]);
      // Os agentes internos que a empresa ganhou no primeiro uso (M4-02) têm a pessoa como responsável.
      const pessoa = await c.query<{ id: string }>("select id from pessoas where email = $1", [email]);
      const pessoaId = pessoa.rows[0]?.id;
      if (pessoaId) {
        await c.query("delete from conversas where pessoa_id = $1", [pessoaId]);
        await c.query("delete from execucoes_de_agente where pedido_por = $1", [pessoaId]);
        await c.query(
          "delete from agentes where responsavel_id = $1 and tipo = 'interno' and papel = 'especialista'",
          [pessoaId],
        );
        await c.query("delete from agentes where responsavel_id = $1 and tipo = 'interno'", [pessoaId]);
      }
      await c.query("delete from pessoas where email = $1", [email]);
      // A empresa de teste fica (suspensa): a auditoria guarda os eventos dela e não deixa apagar.
      if (empresaId && criouEmpresa) {
        await c.query("update empresas set situacao = 'suspensa' where id = $1", [empresaId]);
      }
      await c.end();
    },
  };
}

/** IP próprio para o teste, para o limite de tentativas por minuto de um não atrapalhar o outro. */
export async function ipProprio(page: Page) {
  const parte = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${parte()}.${parte()}.${parte()}` });
}

export async function entrar(page: Page, email: string) {
  await ipProprio(page);
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
