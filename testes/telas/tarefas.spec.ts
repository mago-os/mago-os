import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("tela de tarefas", () => {
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`tarefas-${test.info().project.name}`, {
      nome: "Teo Tarefa",
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

  test("cria uma tarefa, muda o status, comenta e conclui com o resultado", async ({ page }) => {
    await entrar(page, func.email);
    await page.getByRole("link", { name: "Tarefas" }).first().click();
    await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible();
    await expect(page.getByText("Nenhuma tarefa por aqui.")).toBeVisible();

    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await page.getByLabel("O que precisa ser feito").fill("Revisar o contrato");
    await page.getByLabel("Detalhes (opcional)").fill("Ver a cláusula de prazo.");
    await page.getByRole("button", { name: "Criar tarefa" }).click();

    await expect(page.getByRole("heading", { name: "Revisar o contrato" })).toBeVisible();
    await expect(page.getByText("Ver a cláusula de prazo.")).toBeVisible();
    await page.getByRole("button", { name: "Em andamento" }).click();
    await expect(page.locator("main").getByText("Em andamento").first()).toBeVisible();

    await page.getByPlaceholder("Escreva um comentário").fill("<b>sem HTML</b> só texto");
    await page.getByRole("button", { name: "Comentar" }).click();
    await expect(page.getByText("<b>sem HTML</b> só texto")).toBeVisible();

    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await page.getByLabel("Resultado (o que foi entregue)").fill("Cláusula ajustada para 30 dias.");
    await page.getByRole("button", { name: "Concluir tarefa" }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await expect(page.getByText("Cláusula ajustada para 30 dias.")).toBeVisible();

    // A tarefa concluída sai das abertas e aparece em "Todas".
    await page.getByRole("link", { name: "Tarefas" }).first().click();
    await expect(page.getByText("Nenhuma tarefa por aqui.")).toBeVisible();
    await page.getByRole("button", { name: "Todas", exact: true }).click();
    await expect(page.getByRole("link", { name: /Revisar o contrato/ })).toBeVisible();
  });
});
