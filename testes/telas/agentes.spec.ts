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

test.describe("central de agentes", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`agentes-${test.info().project.name}`, {
      nome: "Alice Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from agentes where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("cadastra o agente, dá uma tarefa a ele, pausa e desliga", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Alice!$/ })).toBeVisible();

    await page.goto("/agentes");
    await expect(page.getByText("Nenhum agente cadastrado.")).toBeVisible();
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await page.getByLabel("Nome").fill("Claude no Mac");
    await page.getByLabel("Onde roda (opcional)").fill("Mac da Alice");
    await page.getByRole("button", { name: "Cadastrar agente" }).click();
    await expect(page.getByRole("heading", { name: "Claude no Mac" })).toBeVisible();
    await expect(page.getByText("Nunca deu sinal")).toBeVisible();

    await page.goto("/tarefas");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    await page.getByLabel("O que precisa ser feito").fill("Organizar os arquivos");
    await page.getByLabel("Responsável").selectOption({ label: "Claude no Mac" });
    await page.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByRole("heading", { name: "Organizar os arquivos" })).toBeVisible();
    await expect(page.getByLabel("Responsável")).toHaveValue(/^agente:/);

    await page.goto("/agentes");
    await page.getByRole("link", { name: /Claude no Mac/ }).click();
    await expect(page.getByText("Tarefas abertas")).toBeVisible();
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByText("Agente pausado.")).toBeVisible();
    await page.getByRole("button", { name: "Retomar" }).click();
    await expect(page.getByText("Agente retomado.")).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Desligar" }).click();
    await expect(page.getByText("Agente desligado.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pausar" })).toHaveCount(0);

    // A tarefa que era do agente passou para a pessoa responsável por ele.
    await page.goto("/tarefas");
    await page.getByRole("link", { name: /Organizar os arquivos/ }).click();
    await expect(page.getByText(/passou para a pessoa responsável/)).toBeVisible();
  });
});
