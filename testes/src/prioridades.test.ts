/**
 * Central de prioridades (M3-07), de ponta a ponta: cada tipo de item aparece só para quem deve, na ordem fixa;
 * adiar esconde até a data, resolver esconde até a situação mudar, e outra empresa não vê nada.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comPessoa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import { listarPrioridades } from "@mago-os/nucleo/tarefas/prioridades";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000ad";

describe.skipIf(!bancoDisponivel)("central de prioridades", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;
  const emails: { para: string; link: string; aparelho: string }[] = [];

  async function criarPessoa(
    nome: string,
    email: string,
    perfil: string,
    area: string | null,
    empresa = empresaId,
  ) {
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [nome, email],
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now())`,
      [empresa, id, perfil, area],
    );
    return id;
  }

  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.7.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)",
      [email],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', $1, 'multiDevice' from pessoas where email = $1 on conflict do nothing",
      [email],
    );
    return ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const ids: Record<string, string> = {};

  function pedir(metodo: "GET" | "POST" | "DELETE", url: string, cookie: string, corpo?: unknown) {
    return app.inject({
      method: metodo,
      url,
      headers: { cookie, origin: SITE, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Um') returning id",
    );
    empresaId = e.rows[0]?.id as string;
    await dono.query("insert into empresas (id, nome) values ($1, 'Outra Empresa')", [OUTRA]);
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    ids.gil = await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.fabio = await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: {
          async enviarLinkDeSenha() {},
          async enviarAparelhoNovo(d) {
            emails.push(d);
          },
        },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotasDosAvisos(app, verificador, poolApp, "chave-publica-de-teste");
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  type Item = { chave: string; tipo: string; titulo: string; motivo: string };
  const central = async (email: string) =>
    ((await pedir("GET", "/prioridades", await como(email))).json() as { itens: Item[] }).itens;

  it("mostra na ordem: atrasada, vence hoje, precisa de ajuda, menção e aviso de agente, só para quem deve", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const nova = async (titulo: string, extra: Record<string, unknown> = {}) =>
      (
        await pedir("POST", "/tarefas", ana, {
          titulo,
          responsavel: { tipo: "pessoa", pessoaId: ids.flora },
          ...extra,
        })
      ).json().id as string;
    await nova("Atrasada", { prazo: { dia: "2020-01-01" } });
    await nova("Vence hoje", { prazo: { dia: hoje } });
    const ajuda = await nova("Com ajuda");
    await pedir("POST", `/tarefas/${ajuda}/status`, flora, { status: "precisa_de_ajuda" });
    const daAna = await nova("Da Ana");
    await pedir("POST", `/tarefas/${daAna}/comentarios`, ana, {
      texto: "@Flora olha",
      mencoes: [{ tipo: "pessoa", pessoaId: ids.flora }],
    });
    // Menção numa tarefa que a Flora não vê não entra na central dela.
    const escondida = (await pedir("POST", "/tarefas", ana, { titulo: "Só da Ana" })).json().id;
    await pedir("POST", `/tarefas/${escondida}/comentarios`, ana, {
      texto: "@Flora",
      mencoes: [{ tipo: "pessoa", pessoaId: ids.flora }],
    });
    await dono.query(
      "insert into avisos (empresa_id, pessoa_id, tipo, texto, link) values ($1, $2, 'agente_sem_sinal', 'O agente Zeca está sem sinal', '/agentes')",
      [empresaId, ids.flora],
    );
    const itens = await central("flora@teste.invalid");
    expect(itens.map((i) => [i.tipo, i.titulo])).toEqual([
      ["atrasada", "Atrasada"],
      ["vence_hoje", "Vence hoje"],
      ["precisa_de_ajuda", "Com ajuda"],
      ["mencao", "Da Ana"],
      ["aviso_de_agente", "O agente Zeca está sem sinal"],
    ]);
    expect(itens[3]?.motivo).toBe("mencionado por Ana Admin agora há pouco");
    // A Ana criou, mas não é a responsável: nada disso é dela. O Fabio não tem nada.
    expect(await central("ana@teste.invalid")).toEqual([]);
    expect(await central("fabio@teste.invalid")).toEqual([]);
    expect(await central("otto@teste.invalid")).toEqual([]);
    // Responder a menção tira o item da central.
    await pedir("POST", `/tarefas/${daAna}/comentarios`, flora, { texto: "Vi" });
    expect((await central("flora@teste.invalid")).map((i) => i.tipo)).not.toContain("mencao");
  });

  it("adiar esconde até a data; resolver esconde até o prazo mudar; aviso resolvido fica lido", async () => {
    const flora = await como("flora@teste.invalid");
    const antes = await central("flora@teste.invalid");
    const atrasada = antes.find((i) => i.tipo === "atrasada") as Item;
    const hoje = antes.find((i) => i.tipo === "vence_hoje") as Item;
    const aviso = antes.find((i) => i.tipo === "aviso_de_agente") as Item;
    // Adiar para ontem não vale.
    expect(
      (await pedir("POST", "/prioridades/adiar", flora, { chave: hoje.chave, ate: "2020-01-01" })).statusCode,
    ).toBe(400);
    expect(
      (await pedir("POST", "/prioridades/adiar", flora, { chave: hoje.chave, ate: "2099-01-01" })).statusCode,
    ).toBe(204);
    expect((await pedir("POST", "/prioridades/resolver", flora, { chave: atrasada.chave })).statusCode).toBe(
      204,
    );
    expect((await pedir("POST", "/prioridades/resolver", flora, { chave: aviso.chave })).statusCode).toBe(
      204,
    );
    expect((await pedir("POST", "/prioridades/resolver", flora, { chave: "qualquer" })).statusCode).toBe(400);
    expect((await central("flora@teste.invalid")).map((i) => i.tipo)).toEqual(["precisa_de_ajuda"]);
    expect(
      (await dono.query("select lido_em from avisos where id = $1", [aviso.chave.slice(6)])).rows[0]?.lido_em,
    ).not.toBeNull();
    // O adiado volta na data (simulada: o "agora" depois do dia).
    const depois = await comPessoa(poolApp, ids.flora as string, empresaId, (c) =>
      listarPrioridades(
        c,
        {
          tipo: "pessoa",
          pessoaId: ids.flora as string,
          filtro: { tipo: "meus", pessoaId: ids.flora as string },
          projetos: "membro",
        },
        new Date("2099-01-02T12:00:00Z"),
      ),
    );
    expect(depois.map((i) => i.titulo)).toContain("Vence hoje");
    // Mudar o prazo da resolvida a traz de volta (chave nova).
    const tarefa = atrasada.chave.split(":")[1] as string;
    await pedir("POST", `/tarefas/${tarefa}/planejamento`, await como("ana@teste.invalid"), {
      prazo: { dia: "2020-02-01" },
    });
    expect((await central("flora@teste.invalid")).map((i) => i.tipo)).toContain("atrasada");
    // Ninguém mais vê os estados da Flora.
    const outros = await comPessoa(
      poolApp,
      ids.ana as string,
      empresaId,
      async (c) => (await c.query("select 1 from estados_de_prioridade")).rowCount,
    );
    expect(outros).toBe(0);
  });
});
