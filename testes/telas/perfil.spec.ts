import { expect, test } from "@playwright/test";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("meu perfil", () => {
  test.describe.configure({ mode: "serial" });
  let pessoa: PessoaDeTeste;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`perfil-${test.info().project.name}`, { nome: "Bruno Perfil" });
  });

  test.afterAll(async () => {
    await pessoa.limpar();
  });

  test("muda o nome e o fuso, e o nome novo aparece na saudação", async ({ page }) => {
    await entrar(page, pessoa.email);
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
    await page.getByLabel("Nome").fill("Beto Perfil");
    await page.getByLabel("Fuso horário").selectOption("Europe/Lisbon");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("status")).toHaveText("Dados salvos.");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /, Beto!$/ })).toBeVisible();
  });

  test("cadastra uma passkey pelo perfil e depois apaga", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await entrar(page, pessoa.email);
    await page.goto("/perfil");
    await expect(page.getByText("Nenhuma passkey cadastrada.")).toBeVisible();
    await page.getByRole("button", { name: "Cadastrar passkey neste aparelho" }).click();
    await expect(page.getByRole("status")).toHaveText("Passkey cadastrada neste aparelho.");
    await expect(page.getByRole("button", { name: /Apagar a passkey/ })).toHaveCount(1);
    await page.getByRole("button", { name: /Apagar a passkey/ }).click();
    await expect(page.getByText("Nenhuma passkey cadastrada.")).toBeVisible();
  });

  test("troca a senha com a senha atual errada mostra o erro em português", async ({ page }) => {
    await entrar(page, pessoa.email);
    await page.goto("/perfil");
    await page.getByLabel("Senha atual").fill("senha errada qualquer");
    await page.getByLabel("Senha nova", { exact: true }).fill("outra frase longa e nova");
    await page.getByLabel("Repita a senha nova").fill("outra frase longa e nova");
    await page.getByRole("button", { name: "Trocar a senha" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Senha incorreta." })).toBeVisible();
  });
});
