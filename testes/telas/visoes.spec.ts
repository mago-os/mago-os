import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, ipProprio, type PessoaDeTeste, SENHA } from "./ajuda.ts";

/** Autenticador virtual do Chromium, no lugar do Touch ID (o administrador precisa do 2FA). */
async function entrarComPasskey(page: Page, email: string) {
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
  await ipProprio(page);
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
  await expect(page.getByRole("heading", { name: /, Vera!$/ })).toBeVisible();
}

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test.describe("visões das tarefas", () => {
  let admin: PessoaDeTeste;

  test.beforeAll(async () => {
    admin = await criarPessoaDeTeste(`visoes-${test.info().project.name}`, {
      nome: "Vera Visoes",
      perfil: "administrador",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from projetos where empresa_id = $1", [admin.empresaId]);
    await c.query("delete from espacos where empresa_id = $1", [admin.empresaId]);
    await c.end();
    await admin.limpar();
  });

  test("Kanban muda o status, o calendário muda o prazo, e a visão fica salva", async ({ page }, info) => {
    await entrarComPasskey(page, admin.email);
    const api = async (caminho: string, corpo: unknown) => {
      const r = await page.request.post(`/api${caminho}`, { data: corpo });
      expect(r.ok()).toBe(true);
      return r.json();
    };
    const espaco = await api("/espacos", { nome: "Operações" });
    const projeto = await api("/projetos", { espacoId: espaco.id, nome: "Construção do Mago OS" });
    await api("/tarefas", { titulo: "Revisar a spec", projetoId: projeto.id, prazo: { dia: hoje() } });
    await api("/tarefas", { titulo: "Velha atrasada", projetoId: projeto.id, prazo: { dia: "2020-01-02" } });

    await page.goto(`/projetos/${projeto.id}`);
    await page.getByRole("tab", { name: "Kanban" }).click();
    const emAndamento = page.locator('[data-coluna="Em andamento"]');
    const cartao = page.getByRole("article", { name: "Revisar a spec" });
    if (info.project.name === "computador") {
      await cartao.dragTo(emAndamento);
    } else {
      // No celular, mover pelo seletor do cartão.
      await page.getByLabel("Mover Revisar a spec").selectOption({ label: "Em andamento" });
    }
    await expect(emAndamento.getByRole("article", { name: "Revisar a spec" })).toBeVisible();

    await page.getByRole("tab", { name: "Calendário" }).click();
    const destino = page.locator("[data-dia]").first();
    const diaDestino = (await destino.getAttribute("data-dia")) as string;
    const hojeCelula = page.locator(`[data-dia="${hoje()}"]`);
    await expect(hojeCelula.getByRole("link", { name: "Revisar a spec" })).toBeVisible();
    if (info.project.name === "computador") {
      await hojeCelula.getByRole("link", { name: "Revisar a spec" }).dragTo(destino);
      await expect(destino.getByRole("link", { name: "Revisar a spec" })).toBeVisible();
      const c = new pg.Client({ connectionString: BANCO_DONO });
      await c.connect();
      const r = await c.query<{ dia: string }>(
        "select to_char(prazo_dia, 'YYYY-MM-DD') as dia from tarefas where empresa_id = $1 and titulo = 'Revisar a spec'",
        [admin.empresaId],
      );
      await c.end();
      expect(r.rows[0]?.dia).toBe(diaDestino);
    }

    await page.getByRole("tab", { name: "Lista" }).click();
    await page.getByLabel("Prazo", { exact: true }).selectOption({ label: "Atrasadas" });
    await expect(page.getByRole("link", { name: /Velha atrasada/ })).toBeVisible();
    page.once("dialog", (d) => void d.accept("Atrasadas do Mago OS"));
    await page.getByRole("button", { name: "Salvar visão" }).click();
    await expect(page.getByRole("button", { name: "Atrasadas do Mago OS", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Atrasadas do Mago OS", exact: true }).click();
    await expect(page.getByLabel("Prazo", { exact: true })).toHaveValue("atrasadas");
  });
});
