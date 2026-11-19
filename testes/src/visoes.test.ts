/**
 * Visões (M3-04), de ponta a ponta pelas rotas: os filtros novos da lista de tarefas e as visões salvas, que são só
 * de quem salvou.
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
const OUTRA = "00000000-0000-7000-8000-0000000000ff";

describe.skipIf(!bancoDisponivel)("visões e filtros", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.4.${ip}` },
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

  const titulos = async (url: string, email = "ana@teste.invalid") =>
    ((await pedir("GET", url, await como(email))).json().tarefas as { titulo: string }[])
      .map((t) => t.titulo)
      .sort();

  it("filtros: responsáveis, agente, prioridade, etiquetas, espaço e subtarefas", async () => {
    const ana = await como("ana@teste.invalid");
    await dono.query("update empresas set fuso_horario = 'America/Sao_Paulo' where id = $1", [empresaId]);
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Robo', $2) returning id",
      [empresaId, ids.ana],
    );
    const agente = a.rows[0]?.id as string;
    const espaco = (await pedir("POST", "/espacos", ana, { nome: "Ops" })).json().id;
    const projeto = (await pedir("POST", "/projetos", ana, { espacoId: espaco, nome: "P" })).json().id;
    const etiqueta = (await pedir("POST", "/etiquetas", ana, { nome: "Cliente", cor: "#3b82f6" })).json().id;
    const mae = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Da Flora urgente",
        responsavel: { tipo: "pessoa", pessoaId: ids.flora },
        prioridade: "urgente",
        projetoId: projeto,
        etiquetas: [etiqueta],
      })
    ).json().id;
    await pedir("POST", "/tarefas", ana, {
      titulo: "Do robo",
      responsavel: { tipo: "agente", agenteId: agente },
    });
    await pedir("POST", "/tarefas", ana, { titulo: "Sem prioridade" });
    await pedir("POST", "/tarefas", ana, { titulo: "Sub", tarefaMaeId: mae });

    expect(await titulos(`/tarefas?responsaveis=p:${ids.flora}`)).toEqual(["Da Flora urgente"]);
    expect(await titulos(`/tarefas?responsaveis=a:${agente}`)).toEqual(["Do robo"]);
    expect(await titulos("/tarefas?agente=1")).toEqual(["Do robo"]);
    expect(await titulos("/tarefas?prioridades=urgente")).toEqual(["Da Flora urgente"]);
    expect(await titulos(`/tarefas?etiquetas=${etiqueta}`)).toEqual(["Da Flora urgente"]);
    expect(await titulos(`/tarefas?espaco=${espaco}`)).toEqual(["Da Flora urgente", "Sub"]);
    expect(await titulos(`/tarefas?espaco=${espaco}&subtarefas=0`)).toEqual(["Da Flora urgente"]);
    expect((await titulos("/tarefas?prioridades=sem")).includes("Da Flora urgente")).toBe(false);
    expect((await pedir("GET", "/tarefas?prazo=ontem", ana)).statusCode).toBe(400);
  });

  it("prazo: atrasadas, hoje, sem prazo e o intervalo do calendário", async () => {
    const ana = await como("ana@teste.invalid");
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    await pedir("POST", "/tarefas", ana, { titulo: "Velha", prazo: { dia: "2020-01-01" } });
    await pedir("POST", "/tarefas", ana, { titulo: "Hoje", prazo: { dia: hoje } });
    await pedir("POST", "/tarefas", ana, {
      titulo: "Dezembro",
      inicio: "2030-12-01",
      prazo: { dia: "2030-12-10" },
    });
    expect(await titulos("/tarefas?prazo=atrasadas")).toEqual(["Velha"]);
    expect(await titulos("/tarefas?prazo=hoje")).toEqual(["Hoje"]);
    expect((await titulos("/tarefas?prazo=sem_prazo")).includes("Velha")).toBe(false);
    expect(await titulos("/tarefas?de=2030-12-01&ate=2030-12-31")).toEqual(["Dezembro"]);
    // O intervalo atravessado (início antes, prazo depois) também aparece.
    expect(await titulos("/tarefas?de=2030-12-03&ate=2030-12-05")).toEqual(["Dezembro"]);
    expect(await titulos("/tarefas?de=2031-01-01&ate=2031-01-31")).toEqual([]);
  });

  it("visões salvas são só de quem salvou, e uma empresa não vê as da outra", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/visoes", ana, {
      nome: "Atrasadas",
      tipo: "lista",
      filtro: { prazo: "atrasadas" },
      agruparPor: "responsavel",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ nome: "Atrasadas", tipo: "lista", agruparPor: "responsavel" });
    const k = await pedir("POST", "/visoes", ana, {
      nome: "Quadro",
      tipo: "kanban",
      filtro: {},
      agruparPor: "status",
    });
    expect(k.json().agruparPor).toBeNull();
    expect((await pedir("GET", "/visoes", ana)).json().visoes).toHaveLength(2);
    const gil = await como("gil@teste.invalid");
    expect((await pedir("GET", "/visoes", gil)).json().visoes).toEqual([]);
    expect((await pedir("DELETE", `/visoes/${r.json().id}`, gil)).statusCode).toBe(404);
    expect((await pedir("GET", "/visoes", await como("otto@teste.invalid"))).json().visoes).toEqual([]);
    expect((await pedir("DELETE", `/visoes/${r.json().id}`, ana)).statusCode).toBe(200);
  });
});
