import { randomUUID } from "node:crypto";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";

const SENHA = "uma frase longa para os testes de tela";

test.describe("meus aparelhos", () => {
  test.describe.configure({ mode: "serial" });
  let dono: pg.Client;
  let email: string;

  test.beforeAll(async () => {
    email = `aparelhos-${test.info().project.name}-${randomUUID().slice(0, 8)}@teste.invalid`;
    dono = new pg.Client({ connectionString: BANCO_DONO });
    await dono.connect();
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Ana Aparelhos', $1, true) returning id",
      [email],
    );
    const id = p.rows[0]?.id;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
  });

  test.afterAll(async () => {
    await dono.query("delete from pessoas where email = $1", [email]);
    await dono.end();
  });

  async function entrar(page: Page) {
    const parte = () => Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${parte()}.${parte()}.${parte()}` });
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { name: /, Ana!$/ })).toBeVisible();
  }

  test("vê os aparelhos, recebe o aviso de aparelho novo e desconecta com 'Não fui eu'", async ({
    page,
    browser,
  }) => {
    await entrar(page);
    await page.goto("/aparelhos");
    await expect(page.getByText("este aparelho")).toBeVisible();

    // Outro aparelho (outro navegador, sem os cookies deste) entra na mesma conta.
    const outro = await browser.newContext();
    const outraPagina = await outro.newPage();
    await entrar(outraPagina);

    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Novo acesso");
    await page.getByRole("button", { name: "Não fui eu" }).click();
    await expect(page.getByText("troque a sua senha")).toBeVisible();

    await outraPagina.reload();
    await expect(outraPagina).toHaveURL(/\/entrar$/);
    await outro.close();
  });
});
