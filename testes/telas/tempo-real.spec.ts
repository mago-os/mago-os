import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("tempo real", () => {
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`tempo-real-${test.info().project.name}`, {
      nome: "Rita Real",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [func.empresaId]);
    await c.end();
    await func.limpar();
  });

  test("comentário feito numa aba aparece na outra em menos de 2 segundos, sem recarregar", async ({
    page,
    context,
  }) => {
    await entrar(page, func.email);
    await page.goto("/tarefas");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await page.getByLabel("O que precisa ser feito").fill("Tarefa ao vivo");
    await page.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByRole("heading", { name: "Tarefa ao vivo" })).toBeVisible();

    // A outra aba fica na lista e na mesma tarefa, sem recarregar.
    const outra = await context.newPage();
    await outra.goto(page.url());
    await expect(outra.getByRole("heading", { name: "Tarefa ao vivo" })).toBeVisible();
    const lista = await context.newPage();
    await lista.goto("/tarefas");
    await expect(lista.getByRole("link", { name: /Tarefa ao vivo/ })).toBeVisible();
    // Dá tempo de as duas abas abrirem o WebSocket.
    await outra.waitForTimeout(500);

    await page.getByPlaceholder("Escreva um comentário").fill("Chegou ao vivo");
    await page.getByRole("button", { name: "Comentar" }).click();
    await expect(outra.getByText("Chegou ao vivo")).toBeVisible({ timeout: 2000 });
    await expect(lista.locator("[data-destaque]")).toHaveCount(1, { timeout: 2000 });
  });
});
