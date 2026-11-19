import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("central de prioridades", () => {
  let func: PessoaDeTeste;
  let outra: PessoaDeTeste;

  test.beforeAll(async () => {
    func = await criarPessoaDeTeste(`prioridades-${test.info().project.name}`, {
      nome: "Paula Prioridade",
      perfil: "funcionario",
    });
    outra = await criarPessoaDeTeste(`prioridades-outra-${test.info().project.name}`, {
      nome: "Otávio Outro",
      perfil: "funcionario",
      empresaId: func.empresaId as string,
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [func.empresaId]);
    await c.query("delete from avisos where empresa_id = $1", [func.empresaId]);
    await c.end();
    await outra.limpar();
    await func.limpar();
  });

  test("o Início mostra as prioridades em ordem; adiar e resolver tiram da lista", async ({
    page,
    browser,
  }) => {
    const contexto = await browser.newContext();
    const daOutra = await contexto.newPage();
    await entrar(daOutra, outra.email);
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const eu = (await c.query<{ id: string }>("select id from pessoas where email = $1", [func.email]))
      .rows[0]?.id;
    await c.end();
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const criar = (titulo: string, prazo?: string) =>
      daOutra.request.post("/api/tarefas", {
        data: {
          titulo,
          responsavel: { tipo: "pessoa", pessoaId: eu },
          ...(prazo ? { prazo: { dia: prazo } } : {}),
        },
      });
    expect((await criar("Pagar o fornecedor", "2020-01-01")).ok()).toBe(true);
    expect((await criar("Ligar para o cliente", hoje)).ok()).toBe(true);
    await contexto.close();

    await entrar(page, func.email);
    await page.goto("/");
    const lista = page.getByRole("list", { name: "Itens da central de prioridades" });
    await expect(lista.getByRole("listitem")).toHaveCount(2);
    await expect(lista.getByRole("listitem").nth(0)).toContainText("Pagar o fornecedor");
    await expect(lista.getByRole("listitem").nth(0)).toContainText("Atrasada");
    await expect(lista.getByRole("listitem").nth(1)).toContainText("vence hoje");

    const primeira = lista.getByRole("listitem").nth(0);
    await primeira.getByRole("button", { name: "Adiar" }).click();
    await primeira.getByRole("button", { name: "Até amanhã" }).click();
    await expect(lista.getByRole("listitem")).toHaveCount(1);
    await lista.getByRole("listitem").nth(0).getByRole("button", { name: "Resolvido" }).click();
    await expect(page.getByText("Nada pedindo atenção agora. Bom trabalho!")).toBeVisible();
  });
});
