import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("busca Ctrl+K", () => {
  let func: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`busca-${test.info().project.name}`, {
      nome: "Bia Busca",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [func.empresaId]);
    await c.end();
    await func.limpar();
  });

  test('Ctrl+K, "bakup" e Enter abrem a tarefa "Conferir o backup"; os comandos rápidos ficam na mesma caixa', async ({
    page,
  }) => {
    await entrar(page, func.email);
    const criou = await page.request.post("/api/tarefas", { data: { titulo: "Conferir o backup" } });
    expect(criou.ok()).toBe(true);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Buscar (Ctrl+K)" })).toBeVisible();
    // No computador, o atalho; no celular, a lupa.
    if (test.info().project.name === "computador") await page.keyboard.press("Control+k");
    else await page.getByRole("button", { name: "Buscar (Ctrl+K)" }).click();
    const caixa = page.getByRole("combobox", { name: "O que você procura?" });
    await expect(caixa).toBeFocused();
    await expect(page.getByRole("option", { name: "Nova tarefa" })).toBeVisible();
    await caixa.fill("bakup");
    await expect(page.getByRole("option", { name: /Conferir o backup/ })).toBeVisible();
    await caixa.press("Enter");
    await expect(page.getByRole("heading", { name: "Conferir o backup" })).toBeVisible();

    // Comando rápido só pelo teclado.
    await page.getByRole("button", { name: "Buscar (Ctrl+K)" }).click();
    await page.getByRole("combobox", { name: "O que você procura?" }).fill("nova tar");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("O que precisa ser feito")).toBeVisible();
  });
});
