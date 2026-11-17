/**
 * Convites e desligamento (M1-07) nas telas: a administradora convida, o convidado define a senha pelo link e
 * entra, e o desligamento tira o acesso na hora. Sem o Resend no Mac, o link vai para o log da API: o teste troca o
 * código guardado no banco por um conhecido e abre o link com ele.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

const SENHA_NOVA = "a frase da conta nova do convidado";

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

test.describe("convites", () => {
  test.describe.configure({ mode: "serial" });
  let admin: PessoaDeTeste;
  const convidado = `nora-${randomUUID().slice(0, 8)}@teste.invalid`;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`admin-convite-${test.info().project.name}`, {
      nome: "Alice Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from acesso.travas where email = $1", [convidado]);
    await c.query("delete from pessoas where email = $1", [convidado]);
    await c.end();
    await admin.limpar();
  });

  test("convida, o convidado define a senha pelo link e entra; desligar tira o acesso", async ({
    page,
    browser,
  }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Alice!$/ })).toBeVisible();

    await page.goto("/pessoas");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByLabel("Nome").fill("Nora Nova");
    await page.getByLabel("E-mail").fill(convidado);
    await page.getByLabel("Área (opcional)").fill("comercial");
    await page.getByRole("button", { name: "Enviar convite" }).click();
    await expect(page.getByText(`Convite enviado para ${convidado}. O link vale 7 dias.`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Nora Nova/ })).toContainText("Convidado");

    // O código de verdade só existe no e-mail (aqui, no log): troca pelo de um conhecido.
    const codigo = randomBytes(32).toString("base64url");
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query(
      "update acesso.convites set codigo = $1 where pessoa_id = (select id from pessoas where email = $2) and usado_em is null and cancelado_em is null",
      [createHash("sha256").update(codigo).digest("hex"), convidado],
    );
    await c.end();

    const outro = await browser.newContext();
    const nora = await outro.newPage();
    await ipProprio(nora);
    await nora.goto(`/convite?codigo=${codigo}`);
    await expect(nora.getByRole("heading", { name: "Bem-vindo, Nora" })).toBeVisible();
    await expect(nora.getByText("Alice Admin convidou você para a")).toBeVisible();
    await nora.getByLabel("Senha", { exact: true }).fill(SENHA_NOVA);
    await nora.getByLabel("Repita a senha").fill(SENHA_NOVA);
    await nora.getByRole("button", { name: "Aceitar o convite" }).click();
    await expect(nora.getByRole("heading", { name: "Tudo certo" })).toBeVisible();
    await nora.getByRole("link", { name: "Entrar" }).click();
    await nora.getByLabel("E-mail").fill(convidado);
    await nora.getByLabel("Senha").fill(SENHA_NOVA);
    await nora.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(nora.getByRole("heading", { name: /, Nora!$/ })).toBeVisible();

    // O mesmo link não vale de novo.
    await nora.goto(`/convite?codigo=${codigo}`);
    await expect(nora.getByRole("heading", { name: "Convite inválido" })).toBeVisible();

    // A administradora desliga a Nora: o acesso dela cai.
    await page.reload();
    await page.getByRole("button", { name: /Nora Nova/ }).click();
    await page.getByRole("button", { name: "Desligar", exact: true }).click();
    await page.getByRole("button", { name: "Sim, desligar Nora" }).click();
    await expect(page.getByText("Nora Nova foi desligado da empresa.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nora Nova/ })).toHaveCount(0);
    await nora.goto("/");
    await expect(nora).toHaveURL(/\/entrar$/);
    await outro.close();
  });
});
