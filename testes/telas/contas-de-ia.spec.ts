/**
 * Contas de IA (M4-01) na tela: o administrador conecta um provedor compatível com OpenAI (um falso, na própria
 * máquina, porque os testes não usam a internet), a chave errada é recusada, a certa entra e nunca volta para a
 * tela, e os modelos chegam desligados até ele liberar.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

const CHAVE = "sk-falsa-da-tela-de-teste-AbC9";

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

test.describe("contas de IA", () => {
  let admin: PessoaDeTeste;
  let provedor: Server;
  let endereco = "";

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`contas-ia-${test.info().project.name}`, {
      nome: "Iara Admin",
      perfil: "administrador",
    });
    // Provedor falso no formato da OpenAI: GET /v1/models com a chave no cabeçalho.
    provedor = createServer((pedido, resposta) => {
      if (pedido.url !== "/v1/models") return resposta.writeHead(404).end();
      if (pedido.headers.authorization !== `Bearer ${CHAVE}`) return resposta.writeHead(401).end();
      resposta.writeHead(200, { "content-type": "application/json" });
      resposta.end(JSON.stringify({ data: [{ id: "modelo-rapido" }, { id: "modelo-esperto" }] }));
    });
    await new Promise<void>((pronto) => provedor.listen(0, "127.0.0.1", pronto));
    endereco = `http://127.0.0.1:${(provedor.address() as AddressInfo).port}/v1`;
  });

  test.afterAll(async () => {
    provedor?.close();
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from contas_de_ia where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from chaves_de_dados where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("conecta, recusa a chave errada, não mostra a chave e libera um modelo", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Iara!$/ })).toBeVisible();

    await page.goto("/agentes");
    await page.getByRole("link", { name: "Contas de IA" }).click();
    await expect(page.getByText("Nenhuma conta de IA conectada.")).toBeVisible();
    await page.getByRole("button", { name: "Conectar" }).click();
    // Assinatura (M4-10): o aviso dos termos aparece, o teto some, e sem marcar o aviso não conecta.
    await page.getByLabel("Plano de assinatura (Claude Pro ou Max)").check();
    await expect(page.getByText(/pode ir contra os termos dele/)).toBeVisible();
    // Nada passa da largura da tela no celular (a lista de provedores já empurrou a página para o lado).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Teto por mês em dólares (opcional)")).toHaveCount(0);
    await page.getByLabel("Nome", { exact: true }).fill("Plano de teste");
    const token = page.getByLabel("Token do plano (gerado por claude setup-token)");
    await token.fill("sk-ant-oat01-falso-de-tela");
    await page.getByRole("button", { name: "Testar e conectar" }).click();
    await expect(page.getByText("Para conectar uma assinatura, marque o aviso dos termos.")).toBeVisible();
    await page.getByLabel("Chave de API (cobrada por uso)").check();
    await page.getByLabel("Nome", { exact: true }).fill("Provedor de teste");
    await page.getByLabel("Provedor").selectOption("compativel_openai");
    await page.getByLabel("Endereço da API").fill(endereco);
    await page.getByLabel("Chave", { exact: true }).fill("sk-errada-da-tela-de-teste");
    await page.getByRole("button", { name: "Testar e conectar" }).click();
    await expect(page.getByText("O provedor recusou a chave.")).toBeVisible();

    await page.getByLabel("Chave", { exact: true }).fill(CHAVE);
    await page.getByLabel("Teto por mês em dólares (opcional)").fill("20");
    await page.getByRole("button", { name: "Testar e conectar" }).click();
    await expect(page.getByText("Chave …AbC9")).toBeVisible();
    await expect(page.getByText(CHAVE)).toHaveCount(0);
    await expect(page.getByLabel("Liberar modelo-rapido")).not.toBeChecked();

    await page.getByLabel("Liberar modelo-rapido").check();
    await expect(page.getByLabel("Liberar modelo-rapido")).toBeChecked();
    await page.getByRole("button", { name: "Testar de novo" }).click();
    await expect(page.getByText("Funcionando.", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("1 de 2 modelos liberados")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(CHAVE);
  });
});
