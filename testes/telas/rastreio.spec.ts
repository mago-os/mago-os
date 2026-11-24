import { expect, test } from "@playwright/test";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/** O erro do sistema mostra o número de rastreio com o botão de copiar (M6-02). */
test.describe("número de rastreio no erro", () => {
  let pessoa: PessoaDeTeste;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`rastreio-${test.info().project.name}`, {
      nome: "Rui Rastreio",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    await pessoa.limpar();
  });

  test("a API falhou: aparece o aviso com o número, e o botão copia", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await entrar(page, pessoa.email);
    const numero = "0123456789abcdef0123456789abcdef";
    await page.route("**/api/tarefas?**", (rota) =>
      rota.fulfill({
        status: 500,
        headers: { "x-rastreio": numero, "content-type": "application/json" },
        body: JSON.stringify({ code: "ERRO_INTERNO", message: "Erro interno." }),
      }),
    );
    await page.goto("/tarefas");
    const aviso = page.getByRole("alert").filter({ hasText: "Algo deu errado do nosso lado." });
    await expect(aviso).toBeVisible();
    await expect(aviso.getByText(numero)).toBeVisible();
    await aviso.getByRole("button", { name: "Copiar" }).click();
    await expect(aviso.getByRole("button", { name: "Copiado" })).toBeVisible();
    await aviso.getByRole("button", { name: "Fechar" }).click();
    await expect(aviso).toBeHidden();
  });
});
