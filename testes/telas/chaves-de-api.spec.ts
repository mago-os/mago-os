import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

/** Autenticador virtual do Chromium, no lugar do Touch ID (o administrador precisa do 2FA). */
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

/** Chaves de API (M7-02): criar, ver a chave uma vez só, usar pela API pública e revogar. E a página /termos. */
test.describe("chaves de API", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`api-${test.info().project.name}`, {
      nome: "Alice Api",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from contadores_da_api where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from chaves_de_api where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from webhooks where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("cria a chave, usa na API pública e revoga", async ({ page, request }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Alice!$/ })).toBeVisible();

    await page.goto("/chaves-de-api");
    await page.getByRole("button", { name: "Nova chave" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("n8n de teste");
    await page.getByLabel("Tarefas e comentários").selectOption("escrever");
    await page.getByRole("button", { name: "Criar chave" }).click();
    const segredo =
      (await page
        .locator("code")
        .filter({ hasText: /^mago_api_[0-9a-z]{10}_/ })
        .textContent()) ?? "";
    expect(segredo).toMatch(/^mago_api_/);

    const criada = await request.post("/api/v1/tarefas", {
      headers: { authorization: `Bearer ${segredo}` },
      data: { titulo: "Criada pela API" },
    });
    expect(criada.status(), await criada.text()).toBe(201);

    // Copiar mostra que copiou.
    await page.getByRole("button", { name: "Copiar" }).click();
    await expect(page.getByRole("button", { name: "Copiada!" })).toBeVisible();
    await expect(page.getByText("Chave copiada para a área de transferência.")).toBeVisible();

    page.on("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Já guardei" }).click();
    await page.getByRole("button", { name: "Revogar" }).click();
    await expect(page.getByText("Chave revogada.")).toBeVisible();
    await page.getByRole("button", { name: "Apagar" }).click();
    await expect(page.getByText("Chave apagada da lista.")).toBeVisible();
    await expect(page.getByText("n8n de teste")).toHaveCount(0);
    const depois = await request.get("/api/v1/tarefas", { headers: { authorization: `Bearer ${segredo}` } });
    expect(depois.status()).toBe(401);
  });

  test("webhooks: cria, mostra o segredo uma vez, manda teste e apaga", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const passkey = page.getByRole("button", { name: /Usar passkey/ });
    await expect(passkey.or(page.getByRole("heading", { name: /, Alice!$/ }))).toBeVisible();
    if (await passkey.isVisible()) await passkey.click();
    await expect(page.getByRole("heading", { name: /, Alice!$/ })).toBeVisible();

    await page.goto("/webhooks");
    await page.getByRole("button", { name: "Novo webhook" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("n8n de teste");
    await page.getByLabel("Endereço (https)").fill("https://n8n.exemplo.invalid/webhook/mago");
    await page.getByLabel("Contato cadastrado").check();
    await page.getByRole("button", { name: "Criar webhook" }).click();
    await expect(page.locator("code").filter({ hasText: /^whsec_/ })).toBeVisible();
    await page.getByRole("button", { name: "Copiar" }).click();
    await expect(page.getByRole("button", { name: "Copiado!" })).toBeVisible();
    await page.getByRole("button", { name: "Já guardei" }).click();
    await page.getByRole("button", { name: "Mandar teste" }).click();
    await expect(page.getByText(/Teste enviado/)).toBeVisible();
    await expect(page.getByText("webhook.teste")).toBeVisible();
    page.on("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Apagar" }).click();
    await expect(page.getByText("Webhook apagado.")).toBeVisible();
  });

  test("os Termos de Uso abrem sem login", async ({ page }) => {
    await page.goto("/termos");
    await expect(page.getByRole("heading", { name: "Termos de Uso do Mago OS" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Termos de Uso" })).toBeVisible();
  });
});
