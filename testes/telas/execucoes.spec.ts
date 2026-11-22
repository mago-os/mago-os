/**
 * Passo a passo (M4-07) na tela: o administrador abre a tarefa, vê a execução do Gerente de projetos e cada passo,
 * com o custo. A gravação dos passos e quem vê os detalhes estão em testes/src/agentes-internos.test.ts.
 */
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

test.describe("passo a passo", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`passos-${test.info().project.name}`, {
      nome: "Paula Admin",
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

  test("abre a tarefa, a execução do Gerente e vê cada passo com o custo", async ({ page }) => {
    await autenticadorVirtual(page);
    await ipProprio(page);
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Paula!$/ })).toBeVisible();
    await page.goto("/agentes");
    await expect(page.getByRole("link", { name: /Gerente de projetos/ })).toBeVisible();

    // Uma execução do Gerente numa tarefa, com dois passos e o custo, direto no banco (o motor grava assim).
    const tarefa = await page.request.post("/api/tarefas", { data: { titulo: "Planejar o lançamento" } });
    const tarefaId = (await tarefa.json()).id as string;
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const e = await c.query<{ id: string; agente_id: string; pedido_por: string }>(
      `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, tarefa_id, situacao, iniciada_em,
         terminada_em, resumo)
       select g.empresa_id, g.id, p.id, 'tarefa', $2, 'concluida', now() - interval '20 seconds', now(), 'Plano pronto.'
         from agentes g, pessoas p where g.empresa_id = $1 and g.papel = 'especialista' and p.email = $3
       returning id, agente_id, pedido_por`,
      [admin.empresaId, tarefaId, admin.email],
    );
    const ex = e.rows[0] as { id: string; agente_id: string };
    const k = await c.query<{ id: string }>(
      `insert into consumo_de_ia (empresa_id, execucao_id, agente_id, modelo, tokens_entrada, tokens_saida, custo_micros)
       values ($1, $2, $3, 'claude-sonnet-5-5', 1200, 300, 8100) returning id`,
      [admin.empresaId, ex.id, ex.agente_id],
    );
    await c.query(
      `insert into passos_de_execucao (empresa_id, execucao_id, agente_id, tarefa_id, tipo, modelo, texto, ferramenta,
         consumo_id, duracao_ms, criado_em)
       values ($1, $2, $3, $4, 'modelo', 'claude-sonnet-5-5', 'Vou quebrar em subtarefas.', 'planejar', $5, 900,
               now() - interval '10 seconds')`,
      [admin.empresaId, ex.id, ex.agente_id, tarefaId, k.rows[0]?.id],
    );
    await c.query(
      `insert into passos_de_execucao (empresa_id, execucao_id, agente_id, tarefa_id, tipo, ferramenta, entrada,
         resultado, duracao_ms)
       values ($1, $2, $3, $4, 'ferramenta', 'planejar', '{"subtarefas": 3}', '{"criadas": 3}', 40)`,
      [admin.empresaId, ex.id, ex.agente_id, tarefaId],
    );
    await c.end();

    await page.goto(`/tarefas/${tarefaId}`);
    await expect(page.getByText("Execuções de agentes")).toBeVisible();
    await page
      .getByRole("link", { name: /Gerente de projetos/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Execução de Gerente de projetos" })).toBeVisible();
    await expect(page.getByText("Vou quebrar em subtarefas.")).toBeVisible();
    await expect(page.getByText("2. Ferramenta planejar")).toBeVisible();
    await expect(page.getByText("US$ 0,0081").first()).toBeVisible();
    await page.getByText("Resultado").click();
    await expect(page.getByText('"criadas": 3')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
