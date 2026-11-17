import { expect, type Page, test } from "@playwright/test";
import { criarPessoaDeTeste, entrar, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

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

test.describe("telas do administrador", () => {
  test.describe.configure({ mode: "serial" });
  let admin: PessoaDeTeste;
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    const projeto = test.info().project.name;
    admin = await criarPessoaDeTeste(`admin-${projeto}`, { nome: "Alice Admin", perfil: "administrador" });
    func = await criarPessoaDeTeste(`func-${projeto}`, {
      nome: "Felipe Func",
      perfil: "funcionario",
      area: "comercial",
      ...(admin.empresaId ? { empresaId: admin.empresaId } : {}),
    });
  });

  test.afterAll(async () => {
    await func.limpar();
    await admin.limpar();
  });

  test("administradora ajusta uma permissão, aperta a segurança e vê tudo na auditoria", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    // Administrador precisa do 2FA: cadastra a passkey (autenticador virtual) e segue.
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Alice!$/ })).toBeVisible();

    await page.goto("/pessoas");
    await expect(page.getByRole("heading", { name: "Pessoas" })).toBeVisible();
    await page.getByRole("button", { name: /Felipe Func/ }).click();
    const ver = page.getByLabel("Pessoas da empresa: Ver");
    await expect(ver).toHaveValue("meus");
    await ver.selectOption("equipe");
    await expect(page.getByText("Permissão ajustada.")).toBeVisible();
    await expect(page.getByLabel("Pessoas da empresa: Ver")).toHaveValue("equipe");

    await page.goto("/seguranca");
    const exigir = page.getByRole("switch", { name: /Exigir 2FA de todas as pessoas/ });
    await expect(exigir).not.toBeChecked();
    await exigir.check();
    await expect(page.getByText("Regras da empresa salvas.")).toBeVisible();
    await expect(page.getByRole("switch", { name: /Exigir 2FA de todas as pessoas/ })).toBeChecked();
    // Volta como estava, para o funcionário entrar sem 2FA no teste seguinte.
    await page.getByRole("switch", { name: /Exigir 2FA de todas as pessoas/ }).uncheck();
    await expect(page.getByText("Regras da empresa salvas.")).toBeVisible();

    await page.goto("/auditoria");
    await expect(page.getByText("Mudou uma permissão").first()).toBeVisible();
    await expect(page.getByText("Mudou a segurança da empresa").first()).toBeVisible();
    await expect(page.getByText(/Alice Admin/).first()).toBeVisible();
  });

  test("funcionário não vê as telas do administrador", async ({ page }) => {
    await entrar(page, func.email);
    await expect(page.getByRole("link", { name: "Pessoas" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Auditoria" })).toHaveCount(0);
    await page.goto("/auditoria");
    await expect(page.getByRole("heading", { name: "Auditoria" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /, Felipe!$/ })).toBeVisible();
  });
});
