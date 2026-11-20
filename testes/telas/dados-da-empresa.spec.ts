import { expect, type Page, test } from "@playwright/test";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

/** Autenticador virtual do Chromium, no lugar do Touch ID. */
async function autenticadorVirtual(page: Page) {
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
}

test.describe("dados da empresa", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`dados-empresa-${test.info().project.name}`, {
      nome: "Dora Dados",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    await admin.limpar();
  });

  test("o administrador muda o fuso pela tela e a mudança aparece na auditoria", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Dora!$/ })).toBeVisible();

    await page.goto("/dados-da-empresa");
    await expect(page.getByRole("heading", { name: "Dados da empresa" })).toBeVisible();
    await page.getByLabel("Fuso horário").selectOption("Europe/Lisbon");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Dados da empresa salvos.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Fuso horário")).toHaveValue("Europe/Lisbon");

    await page.goto("/auditoria");
    await expect(page.getByText("Mudou os dados ou a segurança da empresa").first()).toBeVisible();
  });
});
