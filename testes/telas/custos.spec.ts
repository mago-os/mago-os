/**
 * Custos (M4-06) na tela: o administrador vê quanto o Coordenador gastou hoje e põe um teto baixo de teste no Gerente
 * de projetos. A conferência dos tetos no motor está em testes/src/agentes-internos.test.ts.
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

test.describe("custos", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`custos-${test.info().project.name}`, {
      nome: "Caio Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    await admin.limpar();
  });

  test("mostra o gasto de hoje do Coordenador e salva um teto baixo para o Gerente", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Caio!$/ })).toBeVisible();

    // A lista de agentes cria o Coordenador e o Gerente; um gasto de hoje do Coordenador entra direto no banco.
    await page.goto("/agentes");
    await expect(page.getByRole("link", { name: /Coordenador/ })).toBeVisible();
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query(
      `insert into consumo_de_ia (empresa_id, agente_id, modelo, tokens_entrada, tokens_saida, custo_micros)
       select empresa_id, id, 'claude-sonnet-5-5', 1000, 500, 1230000 from agentes
        where empresa_id = $1 and papel = 'coordenador'`,
      [admin.empresaId],
    );
    await c.end();

    await page.getByRole("link", { name: "Custos" }).click();
    await expect(page.getByText("US$ 1,23").first()).toBeVisible();
    await expect(page.getByText(/hoje US\$ 1,23/)).toBeVisible();
    await page.getByLabel("Teto de Gerente de projetos").fill("0,01");
    await page
      .getByLabel("Teto de Gerente de projetos")
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Salvar" })
      .click();
    await expect(page.getByText("Teto de Gerente de projetos salvo.")).toBeVisible();
    await expect(page.getByLabel("Teto de Gerente de projetos")).toHaveValue("0.01");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
