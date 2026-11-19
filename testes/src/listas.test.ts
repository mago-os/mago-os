/**
 * Listas, status do projeto, subtarefas e checklist (M3-02), de ponta a ponta pelas rotas.
 * Prova que o banco mantém lista e status certos, que a subtarefa segue a mãe, quem vê o quê, a trava no checklist,
 * a auditoria e o isolamento entre empresas.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000dd";

describe.skipIf(!bancoDisponivel)("listas, status, subtarefas e checklist", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.2.${ip}` },
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

  let espaco = "";
  let projeto = "";
  let outroProjeto = "";
  let geral = "";
  let mae = "";
  const statusDe = async (id: string) =>
    (await pedir("GET", `/projetos/${id}`, await como("ana@teste.invalid"))).json().status as {
      id: string;
      nome: string;
      tipo: string;
      cor: string;
    }[];

  it("projeto novo nasce com a lista Geral e os cinco status, e a tarefa ganha os dois", async () => {
    const ana = await como("ana@teste.invalid");
    espaco = (await pedir("POST", "/espacos", ana, { nome: "Operações" })).json().id;
    projeto = (await pedir("POST", "/projetos", ana, { espacoId: espaco, nome: "Mago OS" })).json().id;
    outroProjeto = (await pedir("POST", "/projetos", ana, { espacoId: espaco, nome: "Site" })).json().id;
    const p = (await pedir("GET", `/projetos/${projeto}`, ana)).json();
    expect(p.listas.map((l: { nome: string }) => l.nome)).toEqual(["Geral"]);
    geral = p.listas[0].id;
    expect(p.status.map((s: { tipo: string }) => s.tipo)).toEqual([
      "a_fazer",
      "em_andamento",
      "precisa_de_ajuda",
      "concluida",
      "cancelada",
    ]);
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Planejar", projetoId: projeto })).json();
    expect(t.listaId).toBe(geral);
    expect(t.statusDoProjetoId).toBe(p.status[0].id);
    mae = t.id;
    const sem = (await pedir("POST", "/tarefas", ana, { titulo: "Avulsa" })).json();
    expect([sem.listaId, sem.statusDoProjetoId]).toEqual([null, null]);
  });

  it("status próprio: cria Em revisão, a tarefa vai para ele, e apagar devolve ao primeiro do tipo", async () => {
    const ana = await como("ana@teste.invalid");
    const atuais = await statusDe(projeto);
    const novos = [
      ...atuais.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo })),
      { nome: "Em revisão", cor: "#8b5cf6", tipo: "em_andamento" },
    ];
    const r = await pedir("POST", `/projetos/${projeto}/status`, ana, { status: novos });
    expect(r.statusCode).toBe(200);
    const revisao = r.json().status.find((s: { nome: string }) => s.nome === "Em revisão");
    // Pôr em "Em revisão" é pegar a tarefa (tipo em andamento), já no status escolhido.
    const m = await pedir("POST", `/tarefas/${mae}/status`, ana, {
      status: "em_andamento",
      statusId: revisao.id,
    });
    expect(m.statusCode).toBe(200);
    expect(m.json()).toMatchObject({ status: "em_andamento", statusDoProjetoId: revisao.id });
    // Status de outro tipo é recusado.
    const errado = await pedir("POST", `/tarefas/${mae}/status`, ana, {
      status: "precisa_de_ajuda",
      statusId: revisao.id,
    });
    expect(errado.statusCode).toBe(400);
    // Apagar "Em revisão": a tarefa volta para o primeiro Em andamento.
    const r2 = await pedir("POST", `/projetos/${projeto}/status`, ana, {
      status: atuais.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo })),
    });
    expect(r2.statusCode).toBe(200);
    const t = (await pedir("GET", `/tarefas/${mae}`, ana)).json().tarefa;
    expect(t.statusDoProjetoId).toBe(atuais[1]?.id);
  });

  it("os status recusam tipo trocado, tipo faltando e nome repetido", async () => {
    const ana = await como("ana@teste.invalid");
    const atuais = (await statusDe(projeto)).map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo }));
    const trocado = atuais.map((s, i) => (i === 0 ? { ...s, tipo: "cancelada" } : s));
    expect((await pedir("POST", `/projetos/${projeto}/status`, ana, { status: trocado })).statusCode).toBe(
      400,
    );
    const faltando = atuais.filter((s) => s.tipo !== "cancelada");
    expect((await pedir("POST", `/projetos/${projeto}/status`, ana, { status: faltando })).statusCode).toBe(
      400,
    );
    const repetido = [...atuais, { nome: "a fazer", cor: "#64748b", tipo: "a_fazer" }];
    expect((await pedir("POST", `/projetos/${projeto}/status`, ana, { status: repetido })).statusCode).toBe(
      400,
    );
  });

  it("listas: cria, muda a tarefa de lista, e excluir passa as tarefas para outra; a última não sai", async () => {
    const ana = await como("ana@teste.invalid");
    const execucao = (await pedir("POST", `/projetos/${projeto}/listas`, ana, { nome: "Execução" })).json();
    expect(execucao.ordem).toBe(1);
    const m = await pedir("POST", `/tarefas/${mae}/lista`, ana, { listaId: execucao.id });
    expect(m.json().listaId).toBe(execucao.id);
    // Lista de outro projeto é recusada.
    const deOutro = (await pedir("GET", `/projetos/${outroProjeto}`, ana)).json().listas[0].id;
    expect((await pedir("POST", `/tarefas/${mae}/lista`, ana, { listaId: deOutro })).statusCode).toBe(400);
    expect((await pedir("DELETE", `/listas/${execucao.id}`, ana)).statusCode).toBe(200);
    expect((await pedir("GET", `/tarefas/${mae}`, ana)).json().tarefa.listaId).toBe(geral);
    expect((await pedir("DELETE", `/listas/${geral}`, ana)).statusCode).toBe(409);
  });

  it("subtarefa segue a mãe (projeto e lista), um nível só, e muda de projeto junto com ela", async () => {
    const ana = await como("ana@teste.invalid");
    const sub = await pedir("POST", "/tarefas", ana, {
      titulo: "Passo 1",
      tarefaMaeId: mae,
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    expect(sub.statusCode).toBe(201);
    expect(sub.json()).toMatchObject({ tarefaMaeId: mae, projetoId: projeto, listaId: geral });
    const neta = await pedir("POST", "/tarefas", ana, { titulo: "Neta", tarefaMaeId: sub.json().id });
    expect(neta.statusCode).toBe(400);
    const lista = await pedir("GET", `/tarefas?projeto=${projeto}`, ana);
    expect(lista.json().subtarefas[mae]).toEqual({ total: 1, prontas: 0 });
    // A mãe muda de projeto, e a subtarefa vai junto, para a primeira lista do outro projeto.
    await pedir("POST", `/tarefas/${mae}/projeto`, ana, { projetoId: outroProjeto });
    const vista = (await pedir("GET", `/tarefas/${mae}`, ana)).json();
    expect(vista.subtarefas[0]).toMatchObject({ projetoId: outroProjeto, listaId: vista.tarefa.listaId });
    // A subtarefa não muda de lista sozinha.
    expect(
      (await pedir("POST", `/tarefas/${sub.json().id}/lista`, ana, { listaId: vista.tarefa.listaId }))
        .statusCode,
    ).toBe(400);
  });

  it("quem alcança a mãe alcança a subtarefa; quem não alcança, não vê nenhuma das duas", async () => {
    const ana = await como("ana@teste.invalid");
    const daAna = (await pedir("POST", "/tarefas", ana, { titulo: "Só da Ana" })).json().id;
    const sub = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Passo do Gil",
        tarefaMaeId: daAna,
        responsavel: { tipo: "pessoa", pessoaId: ids.gil },
      })
    ).json().id;
    // O Gil vê a própria subtarefa, mas não a mãe; o Fabio não vê nenhuma.
    expect((await pedir("GET", `/tarefas/${sub}`, await como("gil@teste.invalid"))).statusCode).toBe(200);
    expect((await pedir("GET", `/tarefas/${daAna}`, await como("gil@teste.invalid"))).statusCode).toBe(404);
    expect((await pedir("GET", `/tarefas/${sub}`, await como("fabio@teste.invalid"))).statusCode).toBe(404);
    // A Flora é responsável pela mãe: vê a subtarefa do Gil também.
    await pedir("POST", `/tarefas/${daAna}/responsavel`, ana, {
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    expect((await pedir("GET", `/tarefas/${sub}`, await como("flora@teste.invalid"))).statusCode).toBe(200);
  });

  it("checklist: cria, marca com quem e quando, e travada por outro só quem pegou mexe", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Com passos",
        responsavel: { tipo: "pessoa", pessoaId: ids.flora },
      })
    ).json().id;
    const item = (await pedir("POST", `/tarefas/${t}/checklist`, ana, { texto: "Abrir o painel" })).json();
    expect(item).toMatchObject({ marcado: false, marcadoPor: null, ordem: 0 });
    const marcado = await pedir("POST", `/tarefas/${t}/checklist/${item.id}`, ana, { marcado: true });
    expect(marcado.json()).toMatchObject({
      marcado: true,
      marcadoPor: { tipo: "pessoa", pessoaId: ids.ana },
    });
    const flora = await como("flora@teste.invalid");
    await pedir("POST", `/tarefas/${t}/pegar`, flora);
    expect(
      (await pedir("POST", `/tarefas/${t}/checklist/${item.id}`, ana, { marcado: false })).statusCode,
    ).toBe(409);
    const desmarcado = await pedir("POST", `/tarefas/${t}/checklist/${item.id}`, flora, { marcado: false });
    expect(desmarcado.json()).toMatchObject({ marcado: false, marcadoPor: null, marcadoEm: null });
    const ev = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 and acao like 'checklist.%' order by sequencia",
      [t],
    );
    expect(ev.rows.map((e) => e.acao)).toEqual(["checklist.editou", "checklist.marcou", "checklist.marcou"]);
  });

  it("a subtarefa não muda de projeto sozinha, e a mãe não se exclui com subtarefa pegada por outro", async () => {
    const ana = await como("ana@teste.invalid");
    const m = (await pedir("POST", "/tarefas", ana, { titulo: "Mãe", projetoId: projeto })).json().id;
    const sub = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Filha",
        tarefaMaeId: m,
        responsavel: { tipo: "pessoa", pessoaId: ids.flora },
      })
    ).json().id;
    expect((await pedir("POST", `/tarefas/${sub}/projeto`, ana, { projetoId: null })).statusCode).toBe(400);
    expect(
      (await pedir("POST", "/tarefas", ana, { titulo: "Com projeto", tarefaMaeId: m, projetoId: projeto }))
        .statusCode,
    ).toBe(400);
    await pedir("POST", `/tarefas/${sub}/pegar`, await como("flora@teste.invalid"));
    expect((await pedir("DELETE", `/tarefas/${m}`, ana)).statusCode).toBe(409);
    await pedir("POST", `/tarefas/${m}/status`, ana, { status: "cancelada" });
    expect(
      (await pedir("POST", "/tarefas", ana, { titulo: "Depois de cancelar", tarefaMaeId: m })).statusCode,
    ).toBe(400);
  });

  it("uma empresa não vê listas, status nem checklist da outra", async () => {
    const otto = await como("otto@teste.invalid");
    expect((await pedir("POST", `/projetos/${projeto}/listas`, otto, { nome: "Intrusa" })).statusCode).toBe(
      404,
    );
    expect((await pedir("DELETE", `/listas/${geral}`, otto)).statusCode).toBe(404);
    expect((await pedir("POST", `/tarefas/${mae}/checklist`, otto, { texto: "x" })).statusCode).toBe(404);
    const app = new pg.Client({ connectionString: banco.urlApp });
    await app.connect();
    try {
      await app.query("select set_config('mago.empresa_id', $1, false)", [OUTRA]);
      for (const tabela of ["listas", "status_de_projeto", "itens_de_checklist"]) {
        expect((await app.query(`select 1 from ${tabela}`)).rowCount).toBe(0);
      }
    } finally {
      await app.end();
    }
  });
});
