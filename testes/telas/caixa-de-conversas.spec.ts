import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

/**
 * Caixa única (M8-04): a conversa esperando a equipe aparece com o número no menu; a pessoa abre, assume, deixa uma
 * nota interna (amarela, "Só a equipe vê"), usa uma resposta pronta com "/", responde (fica "Enviando..." sem o
 * WhatsApp ligado no teste de tela) e resolve.
 */
test.describe("caixa de conversas", () => {
  let pessoa: PessoaDeTeste;
  let conversaId: string;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`caixa-${test.info().project.name}`, {
      nome: "Gil Caixa",
      // O gestor vê todas as conversas e cuida das respostas prontas (o administrador precisaria do 2FA no teste).
      perfil: "gestor_area",
      area: "comercial",
    });
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    const quem = (
      await c.query<{ pessoa_id: string }>("select pessoa_id from vinculos where empresa_id = $1 limit 1", [
        pessoa.empresaId,
      ])
    ).rows[0]?.pessoa_id;
    const canal = await c.query<{ id: string }>(
      `insert into canais_de_contato (empresa_id, nome, provedor, situacao, criado_por)
       values ($1, 'WhatsApp da loja', 'evolution', 'conectado', $2) returning id`,
      [pessoa.empresaId, quem],
    );
    const contato = await c.query<{ id: string }>(
      "insert into contatos (empresa_id, tipo, nome, criado_por) values ($1, 'pessoa', 'Carla Cliente', $2) returning id",
      [pessoa.empresaId, quem],
    );
    const conversa = await c.query<{ id: string }>(
      `insert into conversas_com_contatos (empresa_id, canal_id, contato_id, identificador, situacao, ultimo_a_responder, ultima_mensagem_em)
       values ($1, $2, $3, '+5511955554444', 'esperando_equipe', 'contato', now()) returning id`,
      [pessoa.empresaId, canal.rows[0]?.id, contato.rows[0]?.id],
    );
    conversaId = conversa.rows[0]?.id as string;
    await c.query(
      `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto)
       values ($1, $2, $3, 'chegou', 'contato', 'texto', 'Vocês têm a peça 42?')`,
      [pessoa.empresaId, conversaId, canal.rows[0]?.id],
    );
    await c.query(
      "insert into respostas_prontas (empresa_id, nome, texto, criada_por) values ($1, 'horario', 'Atendemos das 9h às 18h.', $2)",
      [pessoa.empresaId, quem],
    );
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from contatos where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from canais_de_contato where empresa_id = $1", [pessoa.empresaId]);
    await c.query("delete from respostas_prontas where empresa_id = $1", [pessoa.empresaId]);
    await c.end();
    await pessoa.limpar();
  });

  test("abre, assume, anota, responde com a resposta pronta e resolve", async ({ page }) => {
    await entrar(page, pessoa.email);
    await page.goto("/conversas");
    await expect(page.getByRole("heading", { name: "Conversas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Carla Cliente/ }).click();
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversaId}$`));
    const aberta = page.getByRole("region", { name: "Conversa aberta" });
    await expect(aberta.getByText("Vocês têm a peça 42?")).toBeVisible();

    await aberta.getByRole("button", { name: "Assumir" }).click();
    await expect(aberta.getByText(/com você/)).toBeVisible();

    await aberta.getByRole("tab", { name: /Nota interna/ }).click();
    await aberta.getByLabel("Nota interna (só a equipe vê)").fill("Cliente pediu a peça na semana passada");
    await aberta.getByRole("button", { name: "Salvar nota" }).click();
    await expect(aberta.getByText("Cliente pediu a peça na semana passada")).toBeVisible();
    await expect(aberta.getByText(/Só a equipe vê/).first()).toBeVisible();

    await aberta.getByRole("tab", { name: "Responder" }).click();
    await aberta.getByLabel("Mensagem para o contato").fill("/hor");
    await aberta.getByRole("button", { name: /\/horario/ }).click();
    await expect(aberta.getByLabel("Mensagem para o contato")).toHaveValue("Atendemos das 9h às 18h.");
    await aberta.getByRole("button", { name: "Enviar" }).click();
    await expect(aberta.getByText("Atendemos das 9h às 18h.", { exact: true })).toBeVisible();
    await expect(aberta.getByText(/Enviando|Não enviada/).first()).toBeVisible();

    await aberta.getByRole("button", { name: "Resolver" }).click();
    await expect(aberta.getByText(/Conversa resolvida. Reabra para responder./)).toBeVisible();
  });
});
