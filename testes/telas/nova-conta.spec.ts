/**
 * Convite para criar empresa (M1-11) nas telas: o Dono convida, o responsável cria a senha e a conta (pessoa física,
 * com CPF) pelo link e entra como administrador. Sem o Resend no Mac, o teste troca o código guardado por um conhecido.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

const SENHA_NOVA = "a frase da conta nova do cliente";

/** CPF válido e aleatório, para cada execução criar uma conta nova (um documento, uma conta). */
function cpfAleatorio(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const tamanho of [9, 10]) {
    const soma = d.reduce((s, n, i) => s + n * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    d.push(resto === 10 ? 0 : resto);
  }
  return d.join("");
}

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

test.describe("convite para criar empresa", () => {
  let dono: PessoaDeTeste;
  const responsavel = `clara-${randomUUID().slice(0, 8)}@teste.invalid`;
  const cpf = cpfAleatorio();
  const nomeDaConta = `Clara Consultoria ${randomUUID().slice(0, 4)}`;

  test.beforeAll(async () => {
    dono = await criarPessoaDeTeste(`dono-${test.info().project.name}`, { nome: "Dora Dona" });
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query(
      "insert into papeis_plataforma (pessoa_id, papel) select id, 'dono' from pessoas where email = $1",
      [dono.email],
    );
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from acesso.convites_de_empresa where email = $1", [responsavel]);
    // A conta criada fica (suspensa): a auditoria guarda os eventos dela.
    await c.query("update empresas set situacao = 'suspensa' where documento = $1", [cpf]);
    await c.query("delete from pessoas where email = $1", [responsavel]);
    await c.end();
    await dono.limpar();
  });

  test("o Dono convida, o responsável cria a conta pelo link e entra como administrador", async ({
    page,
    browser,
  }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(dono.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Dora!$/ })).toBeVisible();

    await page.goto("/empresas");
    await expect(page.getByRole("heading", { name: "Empresas" })).toBeVisible();
    await page.getByRole("button", { name: "Convidar nova conta" }).click();
    await page.getByLabel("Nome do responsável").fill("Clara Cliente");
    await page.getByLabel("E-mail do responsável").fill(responsavel);
    await page.getByRole("button", { name: "Enviar convite" }).click();
    await expect(page.getByText(`Convite enviado para ${responsavel}. O link vale 7 dias.`)).toBeVisible();
    await expect(page.getByText(`${responsavel} · vale até`, { exact: false })).toBeVisible();

    const codigo = randomBytes(32).toString("base64url");
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query(
      "update acesso.convites_de_empresa set codigo = $1 where email = $2 and usado_em is null and cancelado_em is null",
      [createHash("sha256").update(codigo).digest("hex"), responsavel],
    );
    await c.end();

    const outro = await browser.newContext();
    const clara = await outro.newPage();
    await ipProprio(clara);
    await clara.goto(`/nova-conta?codigo=${codigo}`);
    await expect(clara.getByRole("heading", { name: "Bem-vindo, Clara" })).toBeVisible();
    await clara.getByText("Pessoa física (CPF)").click();
    await clara.getByRole("textbox", { name: "CPF" }).fill("111.111.111-11");
    await clara.getByLabel("Nome completo").fill("Clara Cliente da Silva");
    await clara.getByLabel("Nome no Mago OS").fill(nomeDaConta);
    await clara.getByLabel("Senha", { exact: true }).fill(SENHA_NOVA);
    await clara.getByLabel("Repita a senha").fill(SENHA_NOVA);
    await clara.getByRole("button", { name: "Criar a conta" }).click();
    await expect(clara.getByText("Confira o CPF: ele não é válido.")).toBeVisible();
    await clara
      .getByRole("textbox", { name: "CPF" })
      .fill(cpf.replace(/^(.{3})(.{3})(.{3})(.{2})$/, "$1.$2.$3-$4"));
    await clara.getByRole("button", { name: "Criar a conta" }).click();
    await expect(clara.getByRole("heading", { name: "Conta criada" })).toBeVisible();
    await clara.getByRole("link", { name: "Entrar" }).click();
    await clara.getByLabel("E-mail").fill(responsavel);
    await clara.getByLabel("Senha").fill(SENHA_NOVA);
    await clara.getByRole("button", { name: "Entrar", exact: true }).click();
    // Administradora precisa do 2FA: cadastra a passkey e entra na conta nova.
    await autenticadorVirtual(clara);
    await clara.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(clara.getByRole("heading", { name: /, Clara!$/ })).toBeVisible();
    await expect(clara.getByRole("main").getByText(nomeDaConta)).toBeVisible();
    await outro.close();

    // O Dono vê a conta na lista (só o cadastro), sem estar dentro dela.
    await page.reload();
    await expect(page.getByText(nomeDaConta)).toBeVisible();
    await expect(page.getByText(`${responsavel} · vale até`, { exact: false })).toHaveCount(0);
  });
});
