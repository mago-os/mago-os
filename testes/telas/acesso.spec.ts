import { randomUUID } from "node:crypto";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";

const SENHA = "uma frase longa para os testes de tela";

test.describe("telas de acesso", () => {
  // Em série: a pessoa falsa e o limite de tentativas por minuto são divididos entre os testes do arquivo.
  test.describe.configure({ mode: "serial" });
  let dono: pg.Client;
  let email: string;

  test.beforeAll(async () => {
    // Uma pessoa falsa por projeto (celular e computador), apagada no fim.
    email = `tela-${test.info().project.name}-${randomUUID().slice(0, 8)}@teste.invalid`;
    dono = new pg.Client({ connectionString: BANCO_DONO });
    await dono.connect();
    const pessoa = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Teste de Tela', $1, true) returning id",
      [email],
    );
    const id = pessoa.rows[0]?.id;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
  });

  // Cada teste com um IP próprio, para o limite de tentativas por minuto de um não atrapalhar o outro.
  test.beforeEach(async ({ page }) => {
    const parte = () => Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${parte()}.${parte()}.${parte()}` });
  });

  test.afterAll(async () => {
    await dono.query("delete from acesso.travas where email = $1", [email]);
    await dono.query("delete from pessoas where email = $1", [email]);
    await dono.end();
  });

  test("entra com e-mail e senha, vê o próprio nome e sai", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { name: /, Teste!$/ })).toBeVisible();
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
  });

  test("senha errada mostra a mensagem em português", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(`ninguem-${randomUUID().slice(0, 8)}@teste.invalid`);
    await page.getByLabel("Senha").fill("senha errada qualquer");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
  });

  test("pedir o link de senha não revela se o e-mail existe", async ({ page }) => {
    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail").fill("ninguem@teste.invalid");
    await page.getByRole("button", { name: "Mandar o link" }).click();
    await expect(page.getByRole("status")).toContainText("Se esse e-mail tiver acesso");
  });

  test("link de senha inválido avisa que expirou", async ({ page }) => {
    await page.goto("/redefinir-senha?token=invalido");
    await page.getByLabel("Senha nova").fill(SENHA);
    await page.getByLabel("Repita a senha").fill(SENHA);
    await page.getByRole("button", { name: "Definir a senha" }).click();
    await expect(page.getByRole("alert")).toHaveText("Este link expirou ou já foi usado. Peça um novo.");
  });

  test("erro que volta do Google aparece em português", async ({ page }) => {
    await page.goto("/entrar?error=signup_disabled");
    await expect(page.getByRole("alert")).toContainText("Essa conta Google não tem acesso ao Mago OS");
  });

  test("a tela de entrar cabe no celular sem rolar para os lados", async ({ page }) => {
    await page.goto("/entrar");
    await expect(page.getByRole("button", { name: "Entrar com Google" })).toBeVisible();
    const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(rola).toBe(false);
  });
});
