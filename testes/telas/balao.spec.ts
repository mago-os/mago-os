import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, type PessoaDeTeste } from "./ajuda.ts";

/**
 * O balão do site (M8-07, decisão 0057), num site de fora de verdade (simulado pelo Playwright num endereço https):
 * no site da lista, o botão aparece, o quadro abre, o visitante entra (com a prova de trabalho) e conversa, a página
 * é guardada sem o "?" e a resposta da equipe chega ao balão. Num site fora da lista, o botão não aparece e o
 * navegador recusa abrir o quadro (frame-ancestors).
 */
const LOJA = "https://www.loja-do-teste.com.br";
const OUTRO = "https://outro-site.com.br";

// O Chrome bloqueia, por padrão, um site da internet chamar o computador local (onde o Mago OS roda no teste).
test.use({
  launchOptions: {
    args: [
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests",
    ],
  },
});

test.describe("balão do site", () => {
  let pessoa: PessoaDeTeste;
  let chave: string;
  let canalId: string;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`balao-${test.info().project.name}`, {
      nome: "Gil Balão",
      perfil: "gestor_area",
      area: "comercial",
    });
    chave = randomBytes(33)
      .toString("base64")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 22);
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const quem = (
      await c.query<{ pessoa_id: string }>("select pessoa_id from vinculos where empresa_id = $1 limit 1", [
        pessoa.empresaId,
      ])
    ).rows[0]?.pessoa_id;
    canalId = (
      await c.query<{ id: string }>(
        `insert into canais_de_contato (empresa_id, nome, provedor, situacao, criado_por, chave_publica, dominios,
                                        politica_url, boas_vindas)
         values ($1, 'Chat da loja', 'site', 'conectado', $2, $3, $4, $5, 'Oi! Em que podemos ajudar?') returning id`,
        [pessoa.empresaId, quem, chave, [LOJA], `${LOJA}/privacidade`],
      )
    ).rows[0]?.id as string;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from canais_de_contato where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from contatos where empresa_id = $1", [pessoa.empresaId]);
    await c.end();
    await pessoa.limpar();
  });

  const site = (endereco: string) => (rota: import("@playwright/test").Route) =>
    rota.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><title>Peça 42</title></head><body><h1>Loja</h1>
<script src="http://localhost:4173/balao.js" data-canal="${chave}" async></script>
<iframe id="direto" title="direto" src="http://localhost:4173/balao/${chave}" style="display:none"></iframe>
<p>${endereco}</p></body></html>`,
    });

  test("no site da lista, o visitante conversa pelo balão e recebe a resposta da equipe", async ({
    page,
  }) => {
    await page.route(`${LOJA}/**`, site(LOJA));
    await page.goto(`${LOJA}/produtos/42?cupom=ABC`);
    await page.getByRole("button", { name: "Abrir a conversa com Chat da loja" }).click();
    const quadro = page.frameLocator('iframe[title="Conversa com Chat da loja"]');
    await expect(quadro.getByText("Oi! Em que podemos ajudar?")).toBeVisible();
    await expect(quadro.getByRole("link", { name: "política de privacidade" })).toHaveAttribute(
      "href",
      `${LOJA}/privacidade`,
    );
    await quadro.getByLabel("Sua mensagem").fill("Vocês têm a peça 42 a pronta entrega?");
    await quadro.getByRole("button", { name: "Enviar" }).click();
    await expect(quadro.getByText("Vocês têm a peça 42 a pronta entrega?")).toBeVisible({ timeout: 15_000 });

    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const m = await c.query<{ conversa_id: string; pagina_url: string; pagina_titulo: string }>(
      "select conversa_id, pagina_url, pagina_titulo from mensagens_com_contatos where canal_id = $1",
      [canalId],
    );
    expect(m.rows[0]).toMatchObject({ pagina_url: `${LOJA}/produtos/42`, pagina_titulo: "Peça 42" });
    await c.query(
      `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto, entrega)
       values ($1, $2, $3, 'saiu', 'sistema', 'texto', 'Temos sim, pode vir buscar.', 'pendente')`,
      [pessoa.empresaId, m.rows[0]?.conversa_id, canalId],
    );
    await c.end();
    await expect(quadro.getByText("Temos sim, pode vir buscar.")).toBeVisible({ timeout: 10_000 });
    await quadro.getByRole("button", { name: "Fechar a conversa" }).click();
    await expect(page.locator('iframe[title="Conversa com Chat da loja"]')).toBeHidden();
  });

  test("num site fora da lista, o botão não aparece e o navegador não abre o quadro", async ({ page }) => {
    await page.route(`${OUTRO}/**`, site(OUTRO));
    await page.goto(`${OUTRO}/`);
    await expect(page.getByRole("heading", { name: "Loja" })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("button", { name: /Abrir a conversa/ })).toHaveCount(0);
    // O quadro posto à mão, direto: o navegador recusa (frame-ancestors só com o domínio da loja).
    const direto = page.frames().find((f) => f.name() === "" && f.url().startsWith("chrome-error://"));
    expect(direto, "o quadro direto foi recusado").toBeTruthy();
  });
});
