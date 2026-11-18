/**
 * Tarefas (M2-01), de ponta a ponta: cada perfil entra de verdade e chama as rotas das tarefas.
 * Prova o alcance (funcionário, gestor, administradora), a auditoria e o isolamento entre empresas.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("tarefas", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  const vinculos: Record<string, string> = {};
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
    const v = await dono.query<{ id: string }>(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now()) returning id`,
      [empresa, id, perfil, area],
    );
    vinculos[email] = v.rows[0]?.id as string;
  }

  /** Entra com senha e, para quem precisa, marca o 2FA como confirmado (o 2FA tem testes próprios). */
  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.0.${ip}` },
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
    await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Fina Financeiro", "fina@teste.invalid", "funcionario", "financeiro");
    await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

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
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const idDe = async (email: string) =>
    (await dono.query<{ id: string }>("select id from pessoas where email = $1", [email])).rows[0]
      ?.id as string;
  const titulos = (r: { json(): { tarefas: { titulo: string }[] } }) =>
    r
      .json()
      .tarefas.map((t) => t.titulo)
      .sort();
  let daFlora = "";
  let doFabio = "";
  let daOutra = "";

  it("funcionário cria uma tarefa e ela fica com ele; a administradora cria uma para a Flora", async () => {
    const r = await pedir("POST", "/tarefas", await como("fabio@teste.invalid"), {
      titulo: "Ligar para o cliente",
    });
    expect(r.statusCode).toBe(201);
    doFabio = r.json().id;
    expect(r.json().responsavel).toEqual({ tipo: "pessoa", pessoaId: await idDe("fabio@teste.invalid") });
    expect(r.json().status).toBe("a_fazer");
    const a = await pedir("POST", "/tarefas", await como("ana@teste.invalid"), {
      titulo: "Mandar proposta",
      descricao: "Proposta do plano anual.",
      responsavel: { tipo: "pessoa", pessoaId: await idDe("flora@teste.invalid") },
    });
    expect(a.statusCode).toBe(201);
    daFlora = a.json().id;
    await pedir("POST", "/tarefas", await como("ana@teste.invalid"), { titulo: "Fechar o mês" });
    const o = await pedir("POST", "/tarefas", await como("otto@teste.invalid"), {
      titulo: "Segredo da outra",
    });
    daOutra = o.json().id;
  });

  it("cada um vê só o que alcança: funcionário as suas, gestor as da equipe, administradora todas", async () => {
    expect(titulos(await pedir("GET", "/tarefas", await como("fabio@teste.invalid")))).toEqual([
      "Ligar para o cliente",
    ]);
    expect(titulos(await pedir("GET", "/tarefas", await como("flora@teste.invalid")))).toEqual([
      "Mandar proposta",
    ]);
    expect(titulos(await pedir("GET", "/tarefas", await como("gil@teste.invalid")))).toEqual([
      "Ligar para o cliente",
      "Mandar proposta",
    ]);
    expect(titulos(await pedir("GET", "/tarefas", await como("ana@teste.invalid")))).toEqual([
      "Fechar o mês",
      "Ligar para o cliente",
      "Mandar proposta",
    ]);
    expect(titulos(await pedir("GET", "/tarefas?minhas=1", await como("ana@teste.invalid")))).toEqual([
      "Fechar o mês",
      "Mandar proposta",
    ]);
    expect(titulos(await pedir("GET", "/tarefas", await como("fina@teste.invalid")))).toEqual([]);
  });

  it("funcionário não abre, não comenta e não muda tarefa de outro", async () => {
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("GET", `/tarefas/${daFlora}`, fabio)).statusCode).toBe(404);
    expect((await pedir("POST", `/tarefas/${daFlora}/comentarios`, fabio, { texto: "oi" })).statusCode).toBe(
      404,
    );
    expect(
      (await pedir("POST", `/tarefas/${daFlora}/status`, fabio, { status: "cancelada" })).statusCode,
    ).toBe(404);
  });

  it("a Flora muda o status, comenta e conclui com o resultado, e tudo vai para a auditoria", async () => {
    const flora = await como("flora@teste.invalid");
    const s = await pedir("POST", `/tarefas/${daFlora}/status`, flora, { status: "em_andamento" });
    expect(s.json().status).toBe("em_andamento");
    const c = await pedir("POST", `/tarefas/${daFlora}/comentarios`, flora, { texto: "Comecei a proposta." });
    expect(c.statusCode).toBe(201);
    const f = await pedir("POST", `/tarefas/${daFlora}/status`, flora, {
      status: "concluida",
      resultado: "Proposta enviada.",
    });
    expect(f.json()).toMatchObject({ status: "concluida", resultado: "Proposta enviada." });
    expect(f.json().encerradaEm).not.toBeNull();
    const v = await pedir("GET", `/tarefas/${daFlora}`, flora);
    expect(v.json().comentarios.map((x: { texto: string }) => x.texto)).toEqual(["Comecei a proposta."]);
    expect(Object.values(v.json().nomes)).toContain("Flora Func");
    const r = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [daFlora],
    );
    expect(r.rows.map((l) => l.acao)).toEqual([
      "tarefa.criou",
      "tarefa.mudou_status",
      "tarefa.comentou",
      "tarefa.mudou_status",
    ]);
    const detalhes = await dono.query(
      "select detalhes::text as d from auditoria.eventos where alvo->>'id' = $1",
      [daFlora],
    );
    expect(detalhes.rows.some((l) => l.d.includes("Proposta"))).toBe(false);
  });

  it("tarefa encerrada só sai reabrindo, e repetir o status não apaga o resultado", async () => {
    const flora = await como("flora@teste.invalid");
    const pular = await pedir("POST", `/tarefas/${daFlora}/status`, flora, { status: "em_andamento" });
    expect(pular.statusCode).toBe(409);
    const repetir = await pedir("POST", `/tarefas/${daFlora}/status`, flora, { status: "concluida" });
    expect(repetir.json().resultado).toBe("Proposta enviada.");
    const varios = await pedir("GET", "/tarefas?status=a_fazer&status=concluida", flora);
    expect(varios.statusCode).toBe(200);
  });

  it("reabrir apaga o resultado e a data de encerramento", async () => {
    const r = await pedir("POST", `/tarefas/${daFlora}/status`, await como("flora@teste.invalid"), {
      status: "a_fazer",
      motivo: "Cliente pediu mudança.",
    });
    expect(r.json()).toMatchObject({
      status: "a_fazer",
      resultado: null,
      encerradaEm: null,
      resultadoPor: null,
    });
  });

  it("não dá para pôr como responsável alguém de outra empresa, nem um agente que não existe", async () => {
    const ana = await como("ana@teste.invalid");
    const otto = await pedir("POST", `/tarefas/${doFabio}/responsavel`, ana, {
      responsavel: { tipo: "pessoa", pessoaId: await idDe("otto@teste.invalid") },
    });
    expect(otto.statusCode).toBe(400);
    const agente = await pedir("POST", "/tarefas", ana, {
      titulo: "Para um agente",
      responsavel: { tipo: "agente", agenteId: OUTRA },
    });
    expect(agente.statusCode).toBe(400);
    const flora = await pedir("POST", `/tarefas/${doFabio}/responsavel`, ana, {
      responsavel: { tipo: "pessoa", pessoaId: await idDe("flora@teste.invalid") },
    });
    expect(flora.statusCode).toBe(200);
    // O Fabio criou, então continua vendo a tarefa que passou para a Flora.
    expect((await pedir("GET", `/tarefas/${doFabio}`, await como("fabio@teste.invalid"))).statusCode).toBe(
      200,
    );
  });

  it("empresa não vê tarefa nem comentário da outra, nem pelo id", async () => {
    const otto = await como("otto@teste.invalid");
    expect(titulos(await pedir("GET", "/tarefas", otto))).toEqual(["Segredo da outra"]);
    expect((await pedir("GET", `/tarefas/${daFlora}`, otto)).statusCode).toBe(404);
    expect((await pedir("POST", `/tarefas/${daFlora}/comentarios`, otto, { texto: "x" })).statusCode).toBe(
      404,
    );
    const ana = await como("ana@teste.invalid");
    expect((await pedir("GET", `/tarefas/${daOutra}`, ana)).statusCode).toBe(404);
    expect((await pedir("DELETE", `/tarefas/${daOutra}`, ana)).statusCode).toBe(404);
  });

  it("o banco recusa comentário com empresa diferente da tarefa, e a API não apaga comentários", async () => {
    await expect(
      dono.query("insert into comentarios_de_tarefa (empresa_id, tarefa_id, texto) values ($1, $2, 'x')", [
        OUTRA,
        daFlora,
      ]),
    ).rejects.toThrow();
    const app = new pg.Client({ connectionString: banco.urlApp });
    await app.connect();
    try {
      await expect(app.query("delete from comentarios_de_tarefa")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it("só a administradora exclui", async () => {
    expect((await pedir("DELETE", `/tarefas/${doFabio}`, await como("fabio@teste.invalid"))).statusCode).toBe(
      403,
    );
    expect((await pedir("DELETE", `/tarefas/${doFabio}`, await como("ana@teste.invalid"))).statusCode).toBe(
      200,
    );
  });

  it("pedido fora do contrato é recusado", async () => {
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("POST", "/tarefas", fabio, { titulo: "  " })).statusCode).toBe(400);
    expect((await pedir("GET", "/tarefas?status=pausada", fabio)).statusCode).toBe(400);
  });
});
