import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("notificações", () => {
  let func: PessoaDeTeste;
  let outra: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`notificacoes-${test.info().project.name}`, {
      nome: "Nina Notificada",
      perfil: "funcionario",
    });
    outra = await criarPessoaDeTeste(`notificacoes-outra-${test.info().project.name}`, {
      nome: "Olga Outra",
      perfil: "funcionario",
      empresaId: func.empresaId as string,
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [func.empresaId]);
    await c.query("delete from avisos where empresa_id = $1", [func.empresaId]);
    await c.end();
    await outra.limpar();
    await func.limpar();
  });

  test("a tarefa passada para mim aparece no sino e abre a tarefa; o perfil mostra as preferências", async ({
    page,
    browser,
  }) => {
    // A Olga cria uma tarefa para a Nina.
    const contexto = await browser.newContext();
    const daOlga = await contexto.newPage();
    await entrar(daOlga, outra.email);
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const nina = (await c.query<{ id: string }>("select id from pessoas where email = $1", [func.email]))
      .rows[0]?.id;
    await c.end();
    const criou = await daOlga.request.post("/api/tarefas", {
      data: { titulo: "Conferir o relatório", responsavel: { tipo: "pessoa", pessoaId: nina } },
    });
    expect(criou.ok()).toBe(true);
    await contexto.close();

    await entrar(page, func.email);
    const sino = page.getByRole("button", { name: /^Notificações: 1 não lidas$/ });
    await expect(sino).toBeVisible();
    await sino.click();
    await page.getByRole("button", { name: /Conferir o relatório/ }).click();
    await expect(page.getByRole("heading", { name: "Conferir o relatório" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notificações", exact: true })).toBeVisible();

    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Notificações" })).toBeVisible();
    await page.getByLabel("Menção com @ no push").uncheck();
    await page.reload();
    await expect(page.getByLabel("Menção com @ no push")).not.toBeChecked();
  });
});
