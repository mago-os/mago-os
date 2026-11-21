/**
 * Regras e aprovações (M4-03) na tela: o administrador vê e muda as regras na página do agente, e abre um pedido de
 * aprovação, vê o motivo como texto e recusa explicando. Aprovar (com e sem edição) e vencer estão em
 * testes/src/agentes-internos.test.ts, com um modelo falso.
 */
import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

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

test.describe("regras e aprovações", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`aprovacoes-${test.info().project.name}`, {
      nome: "Dora Admin",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("muda uma regra na página do agente e recusa um pedido explicando", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Dora!$/ })).toBeVisible();

    // A lista de agentes cria o Coordenador e o Gerente de projetos no primeiro uso.
    await page.goto("/agentes");
    await page.getByRole("link", { name: /Coordenador/ }).click();
    await expect(page.getByText("Regras", { exact: true })).toBeVisible();
    const atribuir = page.getByLabel("Regra de Atribuir a outra pessoa");
    await expect(atribuir).toHaveValue("pede_aprovacao");
    await atribuir.selectOption("bloqueado");
    await expect(page.getByText("Regra salva.")).toBeVisible();
    await expect(page.getByText(/ajustada; padrão: Pede aprovação/)).toBeVisible();
    // Todas de uma vez: as que só leem também aceitam "Bloqueado".
    await page.getByLabel("Modo para todas as regras").selectOption("bloqueado");
    await page.getByRole("button", { name: "Aplicar a todas" }).click();
    await expect(page.getByText(/regras mudaram/)).toBeVisible();
    await expect(page.getByLabel("Regra de Ver uma tarefa")).toHaveValue("bloqueado");
    await page.getByLabel("Modo para todas as regras").selectOption("executa");
    await page.getByRole("button", { name: "Aplicar a todas" }).click();
    await expect(page.getByText(/ficaram como estavam/)).toBeVisible();
    await expect(page.getByLabel("Regra de Ver uma tarefa")).toHaveValue("executa");
    // O que só lê não tem os modos de aprovação.
    await expect(page.getByLabel("Regra de Ver uma tarefa").locator("option")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Um pedido do coordenador, em nome da Dora (o motor cria assim; aqui vai direto no banco).
    const parametros = { tarefaId: "00000000-0000-7000-8000-000000000000", agente: "Gerente de projetos" };
    const conferencia = createHash("sha256").update(JSON.stringify(parametros)).digest("hex");
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const r = await c.query<{ id: string }>(
      `insert into aprovacoes (empresa_id, agente_id, pedido_por, acao, parametros, resumo, motivo, conferencia)
         select g.empresa_id, g.id, p.id, 'mudar_prazo', $2, 'Mudar o prazo de "Post do blog" para 30/11', $3, $4
           from agentes g join pessoas p on p.email = $5
          where g.empresa_id = $1 and g.papel = 'coordenador'
        returning id`,
      [admin.empresaId, parametros, "<b>Pedido:</b> o cliente adiou a entrega", conferencia, admin.email],
    );
    await c.end();
    const id = r.rows[0]?.id as string;

    // Procurar nas tarefas por texto livre (sem acento).
    expect((await page.request.post("/api/tarefas", { data: { titulo: "Migração do site" } })).status()).toBe(
      201,
    );
    await page.goto("/tarefas");
    await page.getByLabel("Procurar nas tarefas").fill("migracao");
    await expect(page.getByText("Migração do site").first()).toBeVisible();
    await page.getByLabel("Procurar nas tarefas").fill("nada parecido aqui");
    await expect(page.getByText("Migração do site")).toHaveCount(0);

    await page.goto("/aprovacoes");
    await page.getByRole("link", { name: /Mudar o prazo de "Post do blog"/ }).click();
    await expect(page).toHaveURL(new RegExp(`/aprovacoes/${id}$`));
    await expect(page.getByText("Esperando decisão")).toBeVisible();
    // O motivo do agente aparece como texto, sem virar HTML.
    await expect(page.getByText("<b>Pedido:</b> o cliente adiou a entrega")).toBeVisible();
    await expect(page.getByLabel("Parâmetros da ação")).toHaveValue(/Gerente de projetos/);

    await page.getByRole("button", { name: "Recusar" }).click();
    await page.getByLabel(/Por que recusar/).fill("O cliente ainda não confirmou o adiamento.");
    await page.getByRole("button", { name: "Recusar" }).click();
    await expect(page.getByText("Recusado.")).toBeVisible();
    await expect(page.getByText("Recusada", { exact: true })).toBeVisible();
    await expect(page.getByText("O cliente ainda não confirmou o adiamento.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
