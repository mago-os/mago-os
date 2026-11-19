/**
 * Espaços e projetos (M3-01), de ponta a ponta: cada perfil entra de verdade e chama as rotas.
 * Prova quem cria e edita, quem vê as tarefas de cada projeto (membro, gestor, administradora), o gerente agente,
 * a auditoria e o isolamento entre empresas.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { buscarTarefa, listarTarefas, registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000cc";

describe.skipIf(!bancoDisponivel)("espaços e projetos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let agenteId: string;
  let agenteDaOutra: string;
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.1.${ip}` },
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
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Claude no Mac', $2) returning id",
      [empresaId, ids.ana],
    );
    agenteId = a.rows[0]?.id as string;
    const b = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Agente da Outra', $2) returning id",
      [OUTRA, ids.otto],
    );
    agenteDaOutra = b.rows[0]?.id as string;

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
  let tarefaDoProjeto = "";
  let tarefaSemResponsavel = "";

  it("só a administradora cria espaço; todos veem os espaços", async () => {
    const gil = await pedir("POST", "/espacos", await como("gil@teste.invalid"), { nome: "Comercial" });
    expect(gil.statusCode).toBe(403);
    const r = await pedir("POST", "/espacos", await como("ana@teste.invalid"), { nome: "Operações" });
    expect(r.statusCode).toBe(201);
    espaco = r.json().id;
    expect(r.json().cor).toBe("#1aa39a");
    const lista = await pedir("GET", "/espacos", await como("fabio@teste.invalid"));
    expect(lista.json().espacos.map((e: { nome: string }) => e.nome)).toEqual(["Operações"]);
  });

  it("o funcionário não cria projeto; a administradora cria com diretor, gerente agente e membro", async () => {
    const f = await pedir("POST", "/projetos", await como("fabio@teste.invalid"), {
      espacoId: espaco,
      nome: "Do Fabio",
    });
    expect(f.statusCode).toBe(403);
    const r = await pedir("POST", "/projetos", await como("ana@teste.invalid"), {
      espacoId: espaco,
      nome: "Construção do Mago OS",
      gerente: { tipo: "agente", agenteId },
      membros: [{ tipo: "pessoa", pessoaId: ids.flora }],
      gerenteRecebeSemResponsavel: true,
      inicio: "2026-11-19",
    });
    expect(r.statusCode).toBe(201);
    projeto = r.json().id;
    expect(r.json().diretorId).toBe(ids.ana);
    expect(r.json().membros).toEqual([
      { quem: { tipo: "pessoa", pessoaId: ids.ana }, papel: "diretor" },
      { quem: { tipo: "agente", agenteId }, papel: "gerente" },
      { quem: { tipo: "pessoa", pessoaId: ids.flora }, papel: "membro" },
    ]);
    expect(r.json().inicio).toBe("2026-11-19");
  });

  it("recusa gerente ou membro de outra empresa, e diretor que é também gerente", async () => {
    const ana = await como("ana@teste.invalid");
    const outro = await pedir("POST", "/projetos", ana, {
      espacoId: espaco,
      nome: "Errado",
      gerente: { tipo: "agente", agenteId: agenteDaOutra },
    });
    expect(outro.statusCode).toBe(400);
    const membro = await pedir("POST", "/projetos", ana, {
      espacoId: espaco,
      nome: "Errado",
      membros: [{ tipo: "pessoa", pessoaId: ids.otto }],
    });
    expect(membro.statusCode).toBe(400);
    const igual = await pedir("POST", "/projetos", ana, {
      espacoId: espaco,
      nome: "Errado",
      gerente: { tipo: "pessoa", pessoaId: ids.ana },
    });
    expect(igual.statusCode).toBe(400);
  });

  it("o funcionário vê só os projetos em que é membro; o gestor vê todos", async () => {
    const nomes = (r: { json(): { projetos: { nome: string }[] } }) => r.json().projetos.map((p) => p.nome);
    expect(nomes(await pedir("GET", "/projetos", await como("flora@teste.invalid")))).toEqual([
      "Construção do Mago OS",
    ]);
    expect(nomes(await pedir("GET", "/projetos", await como("fabio@teste.invalid")))).toEqual([]);
    expect(nomes(await pedir("GET", "/projetos", await como("gil@teste.invalid")))).toEqual([
      "Construção do Mago OS",
    ]);
    expect((await pedir("GET", `/projetos/${projeto}`, await como("fabio@teste.invalid"))).statusCode).toBe(
      404,
    );
  });

  it("tarefa no projeto: o membro vê, quem está fora não; sem responsável vai para o gerente", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/tarefas", ana, { titulo: "Planejar o M4", projetoId: projeto });
    expect(r.statusCode).toBe(201);
    tarefaDoProjeto = r.json().id;
    expect(r.json().projetoId).toBe(projeto);
    const s = await pedir("POST", "/tarefas", ana, {
      titulo: "Sem dono",
      projetoId: projeto,
      responsavel: null,
    });
    tarefaSemResponsavel = s.json().id;
    expect(s.json().responsavel).toEqual({ tipo: "agente", agenteId });

    const flora = await como("flora@teste.invalid");
    expect((await pedir("GET", `/tarefas/${tarefaDoProjeto}`, flora)).statusCode).toBe(200);
    expect((await pedir("GET", `/tarefas?projeto=${projeto}`, flora)).json().tarefas).toHaveLength(2);
    // Membro mexe nas tarefas do projeto (comenta e muda o status).
    expect(
      (await pedir("POST", `/tarefas/${tarefaDoProjeto}/comentarios`, flora, { texto: "Vou ver" }))
        .statusCode,
    ).toBe(201);
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("GET", `/tarefas/${tarefaDoProjeto}`, fabio)).statusCode).toBe(404);
    expect((await pedir("GET", `/tarefas?projeto=${projeto}`, fabio)).json().tarefas).toHaveLength(0);
    // O gestor vê as tarefas de todos os projetos, mas só mexe nas que o alcance dele permite.
    const gil = await como("gil@teste.invalid");
    expect((await pedir("GET", `/tarefas/${tarefaDoProjeto}`, gil)).statusCode).toBe(200);
    expect(
      (await pedir("POST", `/tarefas/${tarefaDoProjeto}/status`, gil, { status: "cancelada" })).statusCode,
    ).toBe(404);
  });

  it("funcionário fora do projeto não põe tarefa nele", async () => {
    const r = await pedir("POST", "/tarefas", await como("fabio@teste.invalid"), {
      titulo: "Intrusa",
      projetoId: projeto,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("PROJETO_INVALIDO");
  });

  it("o gerente agente alcança as tarefas do projeto, mas a lista dele é só a dele", async () => {
    const quem = { tipo: "agente" as const, agenteId };
    const lista = await comEmpresa(poolApp, empresaId, (c) => listarTarefas(c, quem, {}));
    expect(lista.map((t) => t.titulo)).toEqual(["Sem dono"]);
    const vista = await comEmpresa(poolApp, empresaId, (c) => buscarTarefa(c, quem, tarefaDoProjeto));
    expect(vista?.titulo).toBe("Planejar o M4");
    expect(tarefaSemResponsavel).not.toBe("");
  });

  it("mudar a tarefa de projeto vai para a auditoria; tirar do projeto também", async () => {
    const ana = await como("ana@teste.invalid");
    const fora = await pedir("POST", `/tarefas/${tarefaDoProjeto}/projeto`, ana, { projetoId: null });
    expect(fora.statusCode).toBe(200);
    expect(fora.json().projetoId).toBeNull();
    const volta = await pedir("POST", `/tarefas/${tarefaDoProjeto}/projeto`, ana, { projetoId: projeto });
    expect(volta.json().projetoId).toBe(projeto);
    const a = await dono.query<{ n: number }>(
      "select count(*)::int as n from auditoria.eventos where acao = 'tarefa.mudou_projeto' and alvo->>'id' = $1",
      [tarefaDoProjeto],
    );
    expect(a.rows[0]?.n).toBe(2);
  });

  it("o diretor edita o projeto e os membros; o membro comum não edita", async () => {
    const flora = await como("flora@teste.invalid");
    expect((await pedir("POST", `/projetos/${projeto}`, flora, { nome: "Outro nome" })).statusCode).toBe(404);
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", `/projetos/${projeto}`, ana, {
      membros: [
        { tipo: "pessoa", pessoaId: ids.flora },
        { tipo: "pessoa", pessoaId: ids.fabio },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().membros).toHaveLength(4);
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("GET", `/tarefas/${tarefaDoProjeto}`, fabio)).statusCode).toBe(200);
    const eventos = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'tipo' = 'projeto' and alvo->>'id' = $1 order by sequencia",
      [projeto],
    );
    expect(eventos.rows.map((e) => e.acao)).toEqual(["projeto.criou", "projeto.mudou_membros"]);
  });

  it("projeto com tarefas não se exclui, mas se arquiva", async () => {
    const ana = await como("ana@teste.invalid");
    expect((await pedir("DELETE", `/projetos/${projeto}`, ana)).statusCode).toBe(409);
    const r = await pedir("POST", `/projetos/${projeto}`, ana, { situacao: "arquivado" });
    expect(r.json().situacao).toBe("arquivado");
    expect((await pedir("GET", "/projetos", ana)).json().projetos).toHaveLength(0);
    expect((await pedir("GET", "/projetos?arquivados=1", ana)).json().projetos).toHaveLength(1);
    const nova = await pedir("POST", "/tarefas", ana, { titulo: "Num arquivado", projetoId: projeto });
    expect(nova.statusCode).toBe(400);
  });

  it("uma empresa não vê espaços, projetos nem membros da outra", async () => {
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", "/espacos", otto)).json().espacos).toEqual([]);
    expect((await pedir("GET", "/projetos?arquivados=1", otto)).json().projetos).toEqual([]);
    expect((await pedir("GET", `/projetos/${projeto}`, otto)).statusCode).toBe(404);
    expect((await pedir("POST", `/espacos/${espaco}`, otto, { nome: "Roubado" })).statusCode).toBe(404);
    const r = await pedir("POST", "/tarefas", otto, { titulo: "Na outra", projetoId: projeto });
    expect(r.statusCode).toBe(400);
    const app = new pg.Client({ connectionString: banco.urlApp });
    await app.connect();
    try {
      await app.query("select set_config('mago.empresa_id', $1, false)", [OUTRA]);
      const m = await app.query("select * from membros_de_projeto");
      expect(m.rowCount).toBe(0);
    } finally {
      await app.end();
    }
  });
});
