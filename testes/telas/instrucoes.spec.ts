/**
 * Instruções e skills (M4-05) na tela: o administrador escreve a camada da empresa, compara versões e volta, e cria,
 * publica e atribui uma skill. A entrega aos agentes está em testes/src/instrucoes.test.ts e testes/src/mcp.test.ts.
 */
import { expect, type Page, test } from "@playwright/test";
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

test.describe("instruções e skills", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`instrucoes-${test.info().project.name}`, {
      nome: "Ines Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    await admin.limpar();
  });

  test("escreve a camada da empresa, compara e volta; cria, publica e atribui uma skill", async ({
    page,
  }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Ines!$/ })).toBeVisible();

    await page.goto("/agentes");
    await page.getByRole("link", { name: "Instruções" }).click();
    const texto = page.getByLabel("Instruções desta camada");
    await texto.fill("Responda sempre em português do Brasil, sem travessão.");
    await page.getByRole("button", { name: "Salvar versão nova" }).click();
    await expect(page.getByText("Salvo como versão 1.")).toBeVisible();
    await texto.fill("Texto que não ficou bom.");
    await page.getByRole("button", { name: "Salvar versão nova" }).click();
    await expect(page.getByText("Salvo como versão 2.")).toBeVisible();
    await page.getByText(/Histórico \(2 versões\)/).click();
    await page.getByRole("button", { name: "Comparar com a atual" }).last().click();
    await expect(page.locator("[data-comparacao]")).toContainText("+ Texto que não ficou bom.");
    await page.getByRole("button", { name: "Voltar para esta" }).click();
    await expect(page.getByText(/Voltou para a versão 1/)).toBeVisible();
    await expect(texto).toHaveValue("Responda sempre em português do Brasil, sem travessão.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto("/agentes/skills");
    await expect(page.getByText("planejar-tarefas")).toBeVisible();
    await page.getByRole("button", { name: "Nova skill" }).click();
    await page.getByLabel(/Nome \(minúsculas/).fill("responder-clientes");
    await page.getByLabel(/Quando usar/).fill("Use ao responder um cliente.");
    await page.getByLabel(/Texto da skill/).fill("Seja cordial.");
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await expect(page.getByText(/Skill criada como rascunho/)).toBeVisible();
    await page.getByRole("button", { name: "Publicar a versão 1" }).click();
    await expect(page.getByText("Versão 1 publicada.", { exact: true })).toBeVisible();
    const coordenador = page.getByRole("checkbox", { name: "Coordenador" });
    await coordenador.click();
    await expect(coordenador).toBeChecked();
    await expect(page.getByText("1 agente").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
