/**
 * Prioridade, prazo, etiquetas e recorrência (M3-03), de ponta a ponta pelas rotas: o prazo no fuso certo (com
 * horário de verão), a próxima tarefa da recorrência (uma só), o planejamento com auditoria e o isolamento.
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
const OUTRA = "00000000-0000-7000-8000-0000000000ee";

describe.skipIf(!bancoDisponivel)("prioridade, prazo, etiquetas e recorrência", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.3.${ip}` },
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

  it("prazo com hora no fuso da empresa: o momento é calculado no fuso, com horário de verão", async () => {
    const ana = await como("ana@teste.invalid");
    // A empresa está em Lisboa. Em março, Lisboa muda de +00:00 para +01:00 no último domingo (29/03/2026).
    await dono.query("update empresas set fuso_horario = 'Europe/Lisbon' where id = $1", [empresaId]);
    const antes = (
      await pedir("POST", "/tarefas", ana, { titulo: "Antes", prazo: { dia: "2026-03-28", hora: "09:00" } })
    ).json();
    expect(antes.prazo).toMatchObject({ dia: "2026-03-28", hora: "09:00", fuso: "Europe/Lisbon" });
    expect(antes.prazo.em).toBe("2026-03-28T09:00:00.000Z");
    const depois = (
      await pedir("POST", "/tarefas", ana, { titulo: "Depois", prazo: { dia: "2026-03-30", hora: "09:00" } })
    ).json();
    expect(depois.prazo.em).toBe("2026-03-30T08:00:00.000Z");
    // Só o dia: vale até 23:59 do dia. Em São Paulo (sem horário de verão), 23:59 = 02:59 do dia seguinte.
    const sp = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Dia inteiro",
        prazo: { dia: "2026-11-23", fuso: "America/Sao_Paulo" },
      })
    ).json();
    expect(sp.prazo).toMatchObject({ hora: null, em: "2026-11-24T02:59:00.000Z" });
    const errado = await pedir("POST", "/tarefas", ana, {
      titulo: "Fuso errado",
      prazo: { dia: "2026-11-23", fuso: "Marte/Olympus" },
    });
    expect(errado.statusCode).toBe(400);
  });

  it("toda segunda às 9h: ao concluir, nasce a da semana seguinte, uma só, com etiquetas e checklist", async () => {
    const ana = await como("ana@teste.invalid");
    const etiqueta = (await pedir("POST", "/etiquetas", ana, { nome: "Rotina", cor: "#3b82f6" })).json();
    expect((await pedir("POST", "/etiquetas", ana, { nome: "rotina", cor: "#3b82f6" })).statusCode).toBe(409);
    // 23/11/2026 é segunda-feira.
    const t = await pedir("POST", "/tarefas", ana, {
      titulo: "Conferir o backup",
      prioridade: "alta",
      prazo: { dia: "2026-11-23", hora: "09:00", fuso: "America/Sao_Paulo" },
      etiquetas: [etiqueta.id],
      recorrencia: { frequencia: "semanal", intervalo: 1, diasDaSemana: [1] },
    });
    expect(t.statusCode).toBe(201);
    const id = t.json().id;
    await pedir("POST", `/tarefas/${id}/checklist`, ana, { texto: "Ver o último backup" });
    const item = (await pedir("GET", `/tarefas/${id}`, ana)).json().checklist[0];
    await pedir("POST", `/tarefas/${id}/checklist/${item.id}`, ana, { marcado: true });

    const concluiu = await pedir("POST", `/tarefas/${id}/status`, ana, { status: "concluida" });
    expect(concluiu.statusCode).toBe(200);
    const proxima = await dono.query<{ id: string }>("select id from tarefas where recorrente_de_id = $1", [
      id,
    ]);
    expect(proxima.rowCount).toBe(1);
    const nova = (await pedir("GET", `/tarefas/${proxima.rows[0]?.id}`, ana)).json();
    expect(nova.tarefa).toMatchObject({
      titulo: "Conferir o backup",
      status: "a_fazer",
      prioridade: "alta",
      ocorrencia: 2,
      recorrenteDeId: id,
      etiquetas: [etiqueta.id],
      prazo: { dia: "2026-11-30", hora: "09:00", fuso: "America/Sao_Paulo", em: "2026-11-30T12:00:00.000Z" },
      criadaPor: { tipo: "sistema" },
    });
    expect(nova.checklist).toMatchObject([{ texto: "Ver o último backup", marcado: false }]);

    // Reabrir e concluir de novo não cria outra.
    await pedir("POST", `/tarefas/${id}/status`, ana, { status: "a_fazer" });
    await pedir("POST", `/tarefas/${id}/status`, ana, { status: "concluida" });
    const de = await dono.query("select 1 from tarefas where recorrente_de_id = $1", [id]);
    expect(de.rowCount).toBe(1);
    const ev = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 and acao = 'tarefa.recorreu'",
      [id],
    );
    expect(ev.rowCount).toBe(1);
  });

  it("recorrência para depois das vezes, e precisa de prazo", async () => {
    const ana = await como("ana@teste.invalid");
    const sem = await pedir("POST", "/tarefas", ana, {
      titulo: "Sem prazo",
      recorrencia: { frequencia: "diaria", intervalo: 1 },
    });
    expect(sem.statusCode).toBe(400);
    const t = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Duas vezes",
        prazo: { dia: "2026-11-23" },
        recorrencia: { frequencia: "diaria", intervalo: 1, vezes: 2 },
      })
    ).json().id;
    await pedir("POST", `/tarefas/${t}/status`, ana, { status: "concluida" });
    const segunda = (
      await dono.query<{ id: string }>("select id from tarefas where recorrente_de_id = $1", [t])
    ).rows[0]?.id as string;
    await pedir("POST", `/tarefas/${segunda}/status`, ana, { status: "concluida" });
    expect((await dono.query("select 1 from tarefas where recorrente_de_id = $1", [segunda])).rowCount).toBe(
      0,
    );
  });

  it("planejamento: prioridade, prazo, início e etiquetas, cada mudança na auditoria", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Planejar" })).json().id;
    const r = await pedir("POST", `/tarefas/${t}/planejamento`, ana, {
      prioridade: "urgente",
      prazo: { dia: "2026-12-10" },
      inicio: "2026-12-01",
    });
    expect(r.json()).toMatchObject({
      prioridade: "urgente",
      inicio: "2026-12-01",
      prazo: { dia: "2026-12-10" },
    });
    expect(
      (await pedir("POST", `/tarefas/${t}/planejamento`, ana, { inicio: "2026-12-11" })).statusCode,
    ).toBe(400);
    const apagou = await pedir("POST", `/tarefas/${t}/planejamento`, ana, { prazo: null, inicio: null });
    expect(apagou.json()).toMatchObject({ prazo: null, inicio: null, prioridade: "urgente" });
    const ev = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [t],
    );
    expect(ev.rows.map((e) => e.acao)).toEqual([
      "tarefa.criou",
      "tarefa.mudou_prioridade",
      "tarefa.mudou_prazo",
      "tarefa.mudou_prazo",
    ]);
  });

  it("só quem exclui todas apaga etiqueta, e uma empresa não vê as etiquetas da outra", async () => {
    const ana = await como("ana@teste.invalid");
    const e = (await pedir("POST", "/etiquetas", ana, { nome: "Apagar", cor: "#ef4444" })).json();
    expect((await pedir("DELETE", `/etiquetas/${e.id}`, await como("gil@teste.invalid"))).statusCode).toBe(
      403,
    );
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", "/etiquetas", otto)).json().etiquetas).toEqual([]);
    const ottoTarefa = (await pedir("POST", "/tarefas", otto, { titulo: "Da outra" })).json().id;
    expect(
      (await pedir("POST", `/tarefas/${ottoTarefa}/planejamento`, otto, { etiquetas: [e.id] })).statusCode,
    ).toBe(400);
    expect((await pedir("DELETE", `/etiquetas/${e.id}`, otto)).statusCode).toBe(404);
    expect((await pedir("DELETE", `/etiquetas/${e.id}`, ana)).statusCode).toBe(200);
  });
});
