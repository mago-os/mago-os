import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

/** Autenticador virtual do Chromium, no lugar do Touch ID (o administrador precisa do 2FA). */
async function entrarComPasskey(page: Page, email: string) {
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
  await ipProprio(page);
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
  await expect(page.getByRole("heading", { name: /, Paula!$/ })).toBeVisible();
}

test.describe("tela de projetos", () => {
  let admin: PessoaDeTeste;
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`projetos-${test.info().project.name}`, {
      nome: "Paula Projetos",
      perfil: "administrador",
    });
    func = await criarPessoaDeTeste(`projetos-func-${test.info().project.name}`, {
      nome: "Fred Fora",
      perfil: "funcionario",
      empresaId: admin.empresaId as string,
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from projetos where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from espacos where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await func.limpar();
    await admin.limpar();
  });

  test("cria espaço e projeto, põe uma tarefa nele, e quem está fora não vê", async ({ page, browser }) => {
    await entrarComPasskey(page, admin.email);
    await page.getByRole("link", { name: "Projetos", exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole("heading", { name: "Projetos", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Novo espaço" }).click();
    await page.getByLabel("Nome (ex.: Operações)").fill("Operações");
    await page.getByRole("button", { name: "Criar espaço" }).click();
    await expect(page.getByRole("heading", { name: "Operações" })).toBeVisible();

    await page.getByRole("button", { name: "Novo projeto" }).click();
    await page.getByLabel("Nome do projeto").fill("Construção do Mago OS");
    await page.getByRole("button", { name: "Criar projeto" }).click();
    await expect(page.getByRole("heading", { name: "Construção do Mago OS" })).toBeVisible();
    await expect(page.getByText("Paula Projetos").first()).toBeVisible();

    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await page.getByLabel("O que precisa ser feito").fill("Detalhar o M4");
    await page.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByRole("heading", { name: "Detalhar o M4" })).toBeVisible();
    await expect(page.getByLabel("Projeto", { exact: true })).toHaveValue(/[0-9a-f-]{36}/);

    await page.getByRole("link", { name: "Projetos", exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole("link", { name: /Construção do Mago OS/ })).toContainText("1 aberta");

    // O funcionário fora do projeto não vê o projeto nem a tarefa dele.
    const outra = await browser.newContext();
    const pagina = await outra.newPage();
    await entrar(pagina, func.email);
    await pagina.goto("/projetos");
    await expect(pagina.getByRole("heading", { name: "Operações" })).toBeVisible();
    await expect(pagina.getByText("Nenhum projeto que você vê aqui.")).toBeVisible();
    await expect(pagina.getByRole("button", { name: "Novo projeto" })).toHaveCount(0);
    await outra.close();
  });
});
