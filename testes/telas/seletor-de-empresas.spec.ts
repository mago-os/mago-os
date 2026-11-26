import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/** Seletor completo de empresas (M7-05): o número de cada empresa no topo e "Todas as empresas" no sino. */
test.describe("seletor de empresas", () => {
  let pessoa: PessoaDeTeste;
  let outraEmpresa = "";

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`seletor-${test.info().project.name}`, {
      nome: "Sara Seletor",
      perfil: "funcionario",
    });
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const e = await c.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
      `Segunda ${test.info().project.name}`,
    ]);
    outraEmpresa = e.rows[0]?.id as string;
    const p = await c.query<{ id: string }>("select id from pessoas where email = $1", [pessoa.email]);
    await c.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, 'funcionario', 'ativo', now(), now())`,
      [outraEmpresa, p.rows[0]?.id],
    );
    await c.query(
      "insert into avisos (empresa_id, pessoa_id, tipo, texto, link) values ($1, $2, 'mencao', 'Chamaram você na segunda', '/tarefas')",
      [outraEmpresa, p.rows[0]?.id],
    );
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from avisos where empresa_id = $1", [outraEmpresa]);
    await c.query("delete from vinculos where empresa_id = $1", [outraEmpresa]);
    await c.query("update empresas set situacao = 'suspensa' where id = $1", [outraEmpresa]);
    await c.end();
    await pessoa.limpar();
  });

  test("o seletor mostra o número da outra empresa e o sino abre o aviso nela", async ({ page }) => {
    await entrar(page, pessoa.email);
    const seletor = page.getByLabel("Empresa");
    // Com duas empresas, escolhe a primeira (a dela).
    await seletor.selectOption(pessoa.empresaId ?? "");
    await expect(seletor).toHaveValue(pessoa.empresaId ?? "");
    await expect(seletor.locator("option", { hasText: /Segunda .* \(1\)/ })).toHaveCount(1);
    await page.getByRole("button", { name: /Notificações/ }).click();
    await page.getByRole("button", { name: "Todas as empresas" }).click();
    await expect(page.getByText("Chamaram você na segunda")).toBeVisible();
    await page.getByText("Chamaram você na segunda").click();
    await expect(page).toHaveURL(/\/tarefas$/);
    await expect(seletor).toHaveValue(outraEmpresa);
  });
});
