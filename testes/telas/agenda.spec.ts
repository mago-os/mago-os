import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/** A agenda em calendário (M5-07, pedido do Sandro em 24/11/2026): Dia, Semana e Mês, e marcar tocando num horário. */
test.describe("agenda em calendário", () => {
  let pessoa: PessoaDeTeste;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`agenda-${test.info().project.name}`, {
      nome: "Ana Agenda",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from eventos where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from avisos where empresa_id = $1", [pessoa.empresaId]);
    await c.end();
    await pessoa.limpar();
  });

  test("o evento aparece no dia, na semana e no mês; tocar num horário vazio abre o evento novo nele", async ({
    page,
  }) => {
    await entrar(page, pessoa.email);
    const hoje = new Date().toLocaleDateString("en-CA");
    const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const criado = await page.request.post("/api/agenda/eventos", {
      data: {
        titulo: "Reunião de planejamento",
        inicio: { dia: hoje, hora: "10:00" },
        fim: { dia: hoje, hora: "11:30" },
        fuso,
        participantes: [],
      },
    });
    expect(criado.ok(), await criado.text()).toBe(true);

    await page.goto("/agenda");
    const visao = page.getByRole("group", { name: "Visão" });
    for (const nome of ["Semana", "Dia", "Mês"]) {
      await visao.getByRole("button", { name: nome }).click();
      await expect(page.getByRole("link", { name: /Reunião de planejamento/ })).toBeVisible();
    }
    // No dia, tocar às 14h abre o evento novo com 14:00 a 15:00.
    await visao.getByRole("button", { name: "Dia" }).click();
    const coluna = page.getByRole("region", { name: `Dia ${hoje}` });
    await coluna.click({ position: { x: 20, y: 14 * 48 + 5 } });
    await expect(page.getByLabel("Começa às")).toHaveValue("14:00");
    await expect(page.getByLabel("Termina às")).toHaveValue("15:00");
  });
});
