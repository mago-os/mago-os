import { expect, test } from "@playwright/test";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("painéis", () => {
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`paineis-${test.info().project.name}`, {
      nome: "Pedro Painel",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    await func.limpar();
  });

  test('monta o layout, salva como "Meu dia", recarrega e ele volta igual', async ({ page }) => {
    await entrar(page, func.email);
    await page.goto("/paineis");
    await expect(page.getByRole("heading", { name: "Painéis" })).toBeVisible();
    await expect(page.getByLabel("Adicionar painel")).toBeEnabled();
    await page.getByLabel("Adicionar painel").selectOption("notificacoes");
    page.once("dialog", (d) => void d.accept("Meu dia"));
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText('Layout "Meu dia" salvo.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Layout", { exact: true })).toHaveValue(/.+/);
    await expect(page.getByLabel("Layout", { exact: true }).locator("option:checked")).toHaveText("Meu dia");
    if (test.info().project.name === "celular") {
      // No celular, os painéis são abas, na ordem salva.
      await expect(page.getByRole("tablist", { name: "Painéis" }).getByRole("tab")).toHaveText([
        "Tarefas",
        "Prioridades",
        "Notificações",
      ]);
      await page.getByRole("tablist", { name: "Painéis" }).getByRole("tab", { name: "Notificações" }).click();
      await expect(page.getByText("Nada novo por aqui.")).toBeVisible();
    } else {
      // No computador, os três painéis voltam (o de notificações aparece ao lado).
      await expect(page.locator(".dv-tab")).toHaveCount(3);
      await expect(page.getByText("Nada novo por aqui.")).toBeVisible();
    }
  });
});
