import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/**
 * A linha do tempo das conversas na ficha do contato (M8-01): o contato criado por uma conversa aparece como "não
 * identificado", a conversa mostra o canal, a situação e o começo da última mensagem, e tocar nela mostra as mensagens
 * (com a nota interna diferente). A caixa única é a M8-04.
 */
test.describe("conversas na ficha do contato", () => {
  let pessoa: PessoaDeTeste;
  let contatoId: string;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`conversas-${test.info().project.name}`, {
      nome: "Gil Conversas",
      // O gestor vê todas as conversas (o administrador precisaria do 2FA no teste).
      perfil: "gestor_area",
      area: "comercial",
    });
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const canal = await c.query<{ id: string }>(
      `insert into canais_de_contato (empresa_id, nome, provedor, criado_por)
       select $1, 'Balão do site', 'site', pessoa_id from vinculos where empresa_id = $1 limit 1 returning id`,
      [pessoa.empresaId],
    );
    const canalId = canal.rows[0]?.id as string;
    const contato = await c.query<{ id: string }>(
      `insert into contatos (empresa_id, tipo, nome, criado_por, identificado, origem_canal_id)
       select $1, 'pessoa', 'Visitante do site', pessoa_id, false, $2 from vinculos where empresa_id = $1 limit 1
       returning id`,
      [pessoa.empresaId, canalId],
    );
    contatoId = contato.rows[0]?.id as string;
    const conversa = await c.query<{ id: string }>(
      `insert into conversas_com_contatos (empresa_id, canal_id, contato_id, identificador, situacao,
                                           ultimo_a_responder, ultima_mensagem_em)
       values ($1, $2, $3, 'visitante:abcdefgh1234', 'esperando_equipe', 'contato', now()) returning id`,
      [pessoa.empresaId, canalId, contatoId],
    );
    const conversaId = conversa.rows[0]?.id as string;
    await c.query(
      `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto, enviada_em)
       values ($1, $2, $3, 'interna', 'sistema', 'nota', 'Cliente antigo, atenção', now() - interval '2 minutes'),
              ($1, $2, $3, 'chegou', 'contato', 'texto', 'Vocês atendem no sábado?', now() - interval '1 minute')`,
      [pessoa.empresaId, conversaId, canalId],
    );
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from contatos where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from canais_de_contato where empresa_id = $1", [pessoa.empresaId]);
    await c.end();
    await pessoa.limpar();
  });

  test("mostra a conversa com a última mensagem e abre as mensagens", async ({ page }) => {
    await entrar(page, pessoa.email);
    await page.goto(`/contatos/${contatoId}`);
    const secao = page.getByRole("region", { name: "Conversas do contato" });
    await expect(secao.getByRole("heading", { name: "Conversas" })).toBeVisible();
    await expect(secao.getByText(/ainda não identificado/)).toBeVisible();
    await expect(secao.getByText("Esperando a equipe")).toBeVisible();
    await expect(secao.getByText("Contato: Vocês atendem no sábado?")).toBeVisible();
    await secao.getByRole("button", { name: /Balão do site/ }).click();
    await expect(secao.getByText("Nota interna", { exact: false }).first()).toBeVisible();
    await expect(secao.getByText("Cliente antigo, atenção")).toBeVisible();
    await expect(secao.getByText("Vocês atendem no sábado?", { exact: true })).toBeVisible();
  });
});
