/**
 * Linha do tempo (M3-05), de ponta a ponta: comentários com menções, notas internas (que não vão para os agentes),
 * editar e apagar, os acontecimentos da tarefa, a menção ao agente pelo MCP e o isolamento.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import {
  buscarTarefa,
  comentar,
  listarComentarios,
  mencoesDoTexto,
  mencoesPendentes,
  registrarRotasDasTarefas,
} from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000ab";

describe.skipIf(!bancoDisponivel)("linha do tempo", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.5.${ip}` },
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
        carteiro: { async enviarLinkDeSenha() {} },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  let tarefa = "";
  let agente = "";

  it("comentário com menção, nota interna, e a linha do tempo junta os acontecimentos", async () => {
    const ana = await como("ana@teste.invalid");
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Claude no Mac', $2) returning id",
      [empresaId, ids.ana],
    );
    agente = a.rows[0]?.id as string;
    tarefa = (await pedir("POST", "/tarefas", ana, { titulo: "Revisar o contrato" })).json().id;
    const c = await pedir("POST", `/tarefas/${tarefa}/comentarios`, ana, {
      texto: "@Claude no Mac olha isso",
      mencoes: [{ tipo: "agente", agenteId: agente }],
    });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ tipo: "comentario", mencoes: [{ tipo: "agente", agenteId: agente }] });
    const n = await pedir("POST", `/tarefas/${tarefa}/comentarios`, ana, {
      texto: "Só entre nós",
      interna: true,
    });
    expect(n.json().tipo).toBe("nota_interna");
    await pedir("POST", `/tarefas/${tarefa}/status`, ana, { status: "precisa_de_ajuda" });
    const vista = (await pedir("GET", `/tarefas/${tarefa}`, ana)).json();
    expect(vista.comentarios.map((x: { tipo: string }) => x.tipo)).toEqual(["comentario", "nota_interna"]);
    expect(vista.acontecimentos.map((x: { tipo: string }) => x.tipo)).toEqual([
      "criou",
      "pegou",
      "mudou_status",
    ]);
    // Menção de quem não é da empresa é recusada.
    const fora = await pedir("POST", `/tarefas/${tarefa}/comentarios`, ana, {
      texto: "oi",
      mencoes: [{ tipo: "pessoa", pessoaId: ids.otto }],
    });
    expect(fora.statusCode).toBe(400);
  });

  it("o agente mencionado vê a tarefa e a menção pelo MCP, sem a nota interna, e responde", async () => {
    const quem = { tipo: "agente" as const, agenteId: agente };
    const pendentes = await comEmpresa(poolApp, empresaId, (c) => mencoesPendentes(c, agente));
    expect(pendentes).toEqual([tarefa]);
    const vista = await comEmpresa(poolApp, empresaId, (c) =>
      buscarTarefa(c, { ...quem, comoGerente: true }, tarefa),
    );
    expect(vista?.titulo).toBe("Revisar o contrato");
    const comentarios = await comEmpresa(poolApp, empresaId, (c) => listarComentarios(c, tarefa, false));
    expect(comentarios.map((x) => x.tipo)).toEqual(["comentario"]);
    // A menção não passa a tarefa para ele: para mexer, ela não está ao alcance.
    expect(await comEmpresa(poolApp, empresaId, (c) => buscarTarefa(c, quem, tarefa))).toBeNull();
    await comEmpresa(poolApp, empresaId, (c) =>
      comentar(c, { tipo: "agente", agenteId: agente }, tarefa, "Vi, olhando."),
    );
    expect(await comEmpresa(poolApp, empresaId, (c) => mencoesPendentes(c, agente))).toEqual([]);
  });

  it("quem escreveu edita em até 15 minutos; apagar deixa o lugar; outra pessoa não mexe", async () => {
    const ana = await como("ana@teste.invalid");
    const id = (
      await pedir("POST", `/tarefas/${tarefa}/comentarios`, ana, { texto: "Primeira versão" })
    ).json().id;
    const ed = await pedir("POST", `/tarefas/${tarefa}/comentarios/${id}`, ana, { texto: "Segunda versão" });
    expect(ed.json()).toMatchObject({ texto: "Segunda versão" });
    expect(ed.json().editadoEm).not.toBeNull();
    await dono.query(
      "update comentarios_de_tarefa set criado_em = now() - interval '16 minutes' where id = $1",
      [id],
    );
    expect(
      (await pedir("POST", `/tarefas/${tarefa}/comentarios/${id}`, ana, { texto: "Tarde" })).statusCode,
    ).toBe(409);
    // A Flora (responsável por outra coisa) não alcança a tarefa; o Gil não é o autor e não exclui todas.
    await pedir("POST", `/tarefas/${tarefa}/responsavel`, ana, {
      responsavel: { tipo: "pessoa", pessoaId: ids.gil },
    });
    expect(
      (await pedir("DELETE", `/tarefas/${tarefa}/comentarios/${id}`, await como("gil@teste.invalid")))
        .statusCode,
    ).toBe(403);
    const apagado = await pedir("DELETE", `/tarefas/${tarefa}/comentarios/${id}`, ana);
    expect(apagado.json()).toMatchObject({ texto: null, mencoes: [] });
    const vista = (await pedir("GET", `/tarefas/${tarefa}`, ana)).json();
    expect(
      vista.comentarios.some((x: { id: string; apagadoEm: string | null }) => x.id === id && x.apagadoEm),
    ).toBe(true);
    const ev = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 and acao in ('tarefa.editou_comentario', 'tarefa.apagou_comentario', 'tarefa.mencionou') order by sequencia",
      [tarefa],
    );
    expect(ev.rows.map((e) => e.acao)).toEqual([
      "tarefa.mencionou",
      "tarefa.editou_comentario",
      "tarefa.apagou_comentario",
    ]);
  });

  it("tirar o @ do texto ao editar tira a menção; menção repetida conta uma vez", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Menção errada" })).json().id;
    const c = await pedir("POST", `/tarefas/${t}/comentarios`, ana, {
      texto: "@Claude no Mac veja",
      mencoes: [
        { tipo: "agente", agenteId: agente },
        { tipo: "agente", agenteId: agente },
      ],
    });
    expect(c.json().mencoes).toHaveLength(1);
    expect(await comEmpresa(poolApp, empresaId, (x) => mencoesPendentes(x, agente))).toContain(t);
    await pedir("POST", `/tarefas/${t}/comentarios/${c.json().id}`, ana, {
      texto: "Esqueça, não era para você",
    });
    expect(await comEmpresa(poolApp, empresaId, (x) => mencoesPendentes(x, agente))).not.toContain(t);
    const quem = { tipo: "agente" as const, agenteId: agente, comoGerente: true };
    expect(await comEmpresa(poolApp, empresaId, (x) => buscarTarefa(x, quem, t))).toBeNull();
  });

  it("menção a quem não vê a tarefa não abre a tarefa, e outra empresa não vê nada", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Só da Ana" })).json().id;
    await pedir("POST", `/tarefas/${t}/comentarios`, ana, {
      texto: "@Fabio",
      mencoes: [{ tipo: "pessoa", pessoaId: ids.fabio }],
    });
    expect((await pedir("GET", `/tarefas/${t}`, await como("fabio@teste.invalid"))).statusCode).toBe(404);
    const app = new pg.Client({ connectionString: banco.urlApp });
    await app.connect();
    try {
      await app.query("select set_config('mago.empresa_id', $1, false)", [OUTRA]);
      for (const tabela of ["mencoes_de_comentario", "acontecimentos_de_tarefa"]) {
        expect((await app.query(`select 1 from ${tabela}`)).rowCount).toBe(0);
      }
    } finally {
      await app.end();
    }
  });

  it("o @nome escrito no texto vira menção: nome inteiro ou primeiro nome sem repetição, sem acento", async () => {
    const achar = (texto: string) =>
      comEmpresa(poolApp, empresaId, async (c) =>
        (await mencoesDoTexto(c, texto)).map((m) => (m.tipo === "pessoa" ? m.pessoaId : m.agenteId)).sort(),
      );
    expect(await achar("@Ana, confira a minuta.")).toEqual([ids.ana]);
    expect(await achar("pedi ao @fábio func e à @Flora")).toEqual([ids.fabio, ids.flora].sort());
    expect(await achar("@Anabela e ana@teste.invalid não são menção")).toEqual([]);
    expect(await achar("@Otto é de outra empresa")).toEqual([]);
    expect(await achar("sem arroba")).toEqual([]);
    // Dois com o mesmo primeiro nome: só o nome inteiro vale.
    ids.ana2 = await criarPessoa("Ana Beatriz", "ana2@teste.invalid", "funcionario", "comercial");
    expect(await achar("@Ana, confira")).toEqual([]);
    expect(await achar("@Ana Beatriz e @Ana Admin")).toEqual([ids.ana, ids.ana2].sort());
  });
});
