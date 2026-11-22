import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste, SENHA } from "./ajuda.ts";

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

  test("ativar o app autenticador com o segundo fator antigo pede a passkey antes, e segue", async ({
    page,
  }) => {
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
    // Uma pessoa só para este teste (a passkey e o 2FA antigo não atrapalham os outros).
    const outra = await criarPessoaDeTeste(`perfil-app-${test.info().project.name}`, { nome: "Ana App" });
    await entrar(page, outra.email);
    await page.goto("/perfil");
    await page.getByRole("button", { name: "Cadastrar passkey neste aparelho" }).click();
    await expect(page.getByRole("status")).toHaveText("Passkey cadastrada neste aparelho.");
    // O último segundo fator passa a ter mais de 10 minutos.
    const dono = new pg.Client({ connectionString: BANCO_DONO });
    await dono.connect();
    try {
      await dono.query(
        "update acesso.sessoes set dois_fatores_em = now() - interval '1 hour' where pessoa_id = (select id from pessoas where email = $1)",
        [outra.email],
      );
    } finally {
      await dono.end();
    }
    await page.getByRole("button", { name: "Ativar o app autenticador" }).click();
    await page.getByRole("button", { name: "Usar app autenticador" }).click();
    // Antes travava só com o aviso; agora pede a confirmação e, depois dela, mostra o QR code.
    await page.getByRole("button", { name: "Usar a passkey" }).click();
    // Quem tem senha confirma a senha também (regra do login), e o QR code aparece.
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("img", { name: "QR code para o app autenticador" })).toBeVisible();
    await outra.limpar();
  });
});
