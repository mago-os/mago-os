/**
 * Conversa com o mago (M4-02) na tela: Ctrl+J abre a conversa, o coordenador pausado é avisado, e a página do
 * coordenador mostra a escolha do modelo de IA. A conversa com um modelo de verdade não roda nos testes de tela
 * (sem internet); o fluxo inteiro, com um modelo falso, está em testes/src/agentes-internos.test.ts.
 */
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

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

test.describe("conversa com o mago", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`conversa-${test.info().project.name}`, {
      nome: "Celia Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from conversas where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from agentes where empresa_id = $1 and papel = 'especialista'", [admin.empresaId]);
    await c.query("delete from agentes where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("abre pela tecla, avisa que o coordenador está pausado e mostra o modelo na página dele", async ({
    page,
  }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Celia!$/ })).toBeVisible();

    await page.keyboard.press("Control+j");
    await expect(page).toHaveURL(/\/conversa$/);
    await expect(page.getByText(/Coordenador ainda está pausado/)).toBeVisible();
    // A sugestão vai para a caixa de texto.
    await page.getByRole("button", { name: /Planeja a migração do blog/ }).click();
    await expect(page.getByLabel(/Mensagem para o Coordenador/)).toHaveValue(/Planeja a migração do blog/);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(
      page.getByText(/O administrador escolhe o modelo de IA e liga em Agentes/).first(),
    ).toBeVisible();

    await page.goto("/agentes");
    await page.getByRole("link", { name: /Coordenador/ }).click();
    await expect(page.getByText("Interno: coordenador")).toBeVisible();
    await expect(page.getByText("Modelo de IA")).toBeVisible();
    await expect(page.getByText(/Nenhum modelo liberado/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar chave" })).toHaveCount(0);
    // Limites de cada execução (M4-08): o administrador ajusta e volta ao padrão.
    await expect(page.getByText("Limites de cada execução")).toBeVisible();
    await page.getByLabel("Rodadas").fill("40");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Limites salvos.")).toBeVisible();
    await page.getByRole("button", { name: "Voltar ao padrão" }).click();
    await expect(page.getByText("Limites de volta ao padrão.")).toBeVisible();
    await expect(page.getByLabel("Rodadas")).toHaveValue("30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
