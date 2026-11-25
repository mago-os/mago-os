import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/**
 * Contatos (M7-01): cadastrar uma organização e uma pessoa dela pela tela (o telefone brasileiro ganha o +55), o aviso
 * de e-mail repetido com o botão Juntar, juntar os dois, e ligar o contato a uma tarefa.
 */
test.describe("contatos", () => {
  let pessoa: PessoaDeTeste;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`contatos-${test.info().project.name}`, {
      nome: "Ana Contatos",
      // O gestor vê, cadastra e junta todos os contatos (o administrador precisaria do 2FA no teste).
      perfil: "gestor_area",
      area: "comercial",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from contatos where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from tarefas where empresa_id = $1", [pessoa.empresaId]);
    await c.end();
    await pessoa.limpar();
  });

  test("cadastra, avisa o repetido, junta e liga à tarefa", async ({ page }) => {
    await entrar(page, pessoa.email);
    const org = await page.request.post("/api/contatos", {
      data: { tipo: "organizacao", nome: "Acme Ltda" },
    });
    expect(org.ok(), await org.text()).toBe(true);

    await page.goto("/contatos");
    await page.getByRole("button", { name: "Novo contato" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Beatriz Lima");
    await page.getByRole("group", { name: "Papel" }).getByRole("button", { name: "Cliente" }).click();
    await page.getByLabel("E-mail, telefone ou endereço").fill("bia@acme.invalid");
    await page.getByRole("button", { name: "Acrescentar" }).click();
    await page.getByLabel("Tipo").selectOption("telefone");
    await page.getByLabel("E-mail, telefone ou endereço").fill("(11) 98765-4321");
    await page.getByRole("button", { name: "Acrescentar" }).click();
    await expect(page.getByText("+55 11 98765-4321")).toBeVisible();
    await page.getByLabel("Ligar a uma organização").fill("Acme");
    await page.getByRole("button", { name: /Acme Ltda/ }).click();
    await page.getByLabel("Cargo em Acme Ltda").fill("Diretora");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Beatriz Lima" })).toBeVisible();
    const primeiraUrl = page.url();
    await expect(page.getByRole("link", { name: /Acme Ltda/ })).toBeVisible();

    // Outro cadastro com o mesmo e-mail: o aviso aparece, com o Juntar.
    const outro = await page.request.post("/api/contatos", {
      data: { tipo: "pessoa", nome: "Bia (recepção)" },
    });
    const outroId = (await outro.json()).contato.id as string;
    await page.goto(`/contatos/${outroId}`);
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("E-mail, telefone ou endereço").fill("bia@acme.invalid");
    await page.getByRole("button", { name: "Acrescentar" }).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText(/já existe em outro contato/)).toBeVisible();

    // Juntar a recepção na Beatriz, a partir da ficha da Beatriz.
    page.on("dialog", (d) => void d.accept());
    await page.goto(`${primeiraUrl}?juntar=${outroId}`);
    await page.getByRole("button", { name: "Juntar", exact: true }).click();
    await expect(page.getByText("Contatos juntados.")).toBeVisible();
    await page.goto(`/contatos/${outroId}`);
    await expect(page).toHaveURL(primeiraUrl);

    // Ligar à tarefa.
    const t = await page.request.post("/api/tarefas", { data: { titulo: "Proposta para a Beatriz" } });
    const tarefaId = (await t.json()).id as string;
    await page.goto(`/tarefas/${tarefaId}`);
    await page.getByLabel("Ligar um contato").fill("Beatriz");
    await page.getByRole("button", { name: /Beatriz Lima/ }).click();
    await expect(page.getByRole("link", { name: "Beatriz Lima" })).toBeVisible();
    await page.goto(primeiraUrl);
    await expect(page.getByRole("link", { name: /Proposta para a Beatriz/ })).toBeVisible();
  });
});
