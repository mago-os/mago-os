/**
 * Perfis e permissões (M1-06), de ponta a ponta: cada perfil entra de verdade e chama as rotas do núcleo.
 * Empresa com administradora, gestor do comercial, dois funcionários do comercial e uma do financeiro.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  catalogoDeModulos,
  criarVerificador,
  registrarRotaDaAuditoria,
  registrarRotasDePermissoes,
  registrarRotasDoAdministrador,
} from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("perfis e permissões", () => {
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

  function pedir(metodo: "GET" | "PUT", url: string, cookie: string, corpo?: unknown) {
    return app.inject({
      method: metodo,
      url,
      headers: { cookie, origin: SITE, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  const nomesDe = (r: { json(): { nome: string }[] }) => r.json().map((p) => p.nome);

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
    app = Fastify();
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDePermissoes(app, verificador, poolApp);
    registrarRotaDaAuditoria(app, verificador, poolApp);
    registrarRotasDoAdministrador(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("administradora vê todas as pessoas da empresa, com e-mail, e ninguém da outra empresa", async () => {
    const r = await pedir("GET", "/empresa/pessoas", await entrar("ana@teste.invalid"));
    expect(r.statusCode).toBe(200);
    expect(nomesDe(r)).toEqual(["Ana Admin", "Fabio Func", "Fina Financeiro", "Flora Func", "Gil Gestor"]);
    expect(r.json().every((p: { email: string | null }) => p.email !== null)).toBe(true);
  });

  it("gestor do comercial vê só a equipe dele, sem e-mail (dado pessoal sensível)", async () => {
    const r = await pedir("GET", "/empresa/pessoas", await entrar("gil@teste.invalid"));
    expect(nomesDe(r)).toEqual(["Fabio Func", "Flora Func", "Gil Gestor"]);
    expect(r.json().every((p: { email: string | null }) => p.email === null)).toBe(true);
  });

  it("funcionário vê só a si mesmo", async () => {
    const r = await pedir("GET", "/empresa/pessoas", await entrar("fabio@teste.invalid"));
    expect(nomesDe(r)).toEqual(["Fabio Func"]);
  });

  it("funcionário não ajusta permissões", async () => {
    const r = await pedir("PUT", "/empresa/permissoes", await entrar("fabio@teste.invalid"), {
      vinculoId: vinculos["fabio@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "tudo",
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SEM_PERMISSAO");
  });

  it("gestor também não ajusta permissões", async () => {
    const r = await pedir("PUT", "/empresa/permissoes", await entrar("gil@teste.invalid"), {
      vinculoId: vinculos["fabio@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "equipe",
    });
    expect(r.statusCode).toBe(403);
  });

  it("a administradora libera a equipe para um funcionário, e ele passa a ver a equipe", async () => {
    const ana = await entrar("ana@teste.invalid");
    const r = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["fabio@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "equipe",
    });
    expect(r.statusCode).toBe(200);
    const fabio = await pedir("GET", "/empresa/pessoas", await entrar("fabio@teste.invalid"));
    expect(nomesDe(fabio)).toEqual(["Fabio Func", "Flora Func", "Gil Gestor"]);
  });

  it("e também pode tirar: gestor com 'ver pessoas' em nada é barrado", async () => {
    const ana = await entrar("ana@teste.invalid");
    await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["gil@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "nada",
    });
    const r = await pedir("GET", "/empresa/pessoas", await entrar("gil@teste.invalid"));
    expect(r.statusCode).toBe(403);
    await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["gil@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "equipe",
    });
  });

  it("liberar dados sensíveis mostra o e-mail; o pedido inválido é recusado", async () => {
    const ana = await entrar("ana@teste.invalid");
    const libera = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["gil@teste.invalid"],
      modulo: "pessoas",
      acao: "ver_sensiveis",
      alcance: "tudo",
    });
    expect(libera.statusCode).toBe(200);
    const gil = await pedir("GET", "/empresa/pessoas", await entrar("gil@teste.invalid"));
    expect(gil.json().every((p: { email: string | null }) => p.email !== null)).toBe(true);

    const meio = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["gil@teste.invalid"],
      modulo: "pessoas",
      acao: "ver_sensiveis",
      alcance: "equipe",
    });
    expect(meio.statusCode).toBe(400);
    const semAcao = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["gil@teste.invalid"],
      modulo: "auditoria",
      acao: "excluir",
      alcance: "tudo",
    });
    expect(semAcao.json().code).toBe("ACAO_INVALIDA");
  });

  it("administrador não recebe ajuste, e não dá para ajustar alguém de outra empresa", async () => {
    const ana = await entrar("ana@teste.invalid");
    const admin = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["ana@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "nada",
    });
    expect(admin.json().code).toBe("ADMINISTRADOR_SEM_AJUSTE");
    const outra = await pedir("PUT", "/empresa/permissoes", ana, {
      vinculoId: vinculos["otto@teste.invalid"],
      modulo: "pessoas",
      acao: "ver",
      alcance: "nada",
    });
    expect(outra.statusCode).toBe(404);
  });

  it("minhas permissões: cada um recebe o próprio mapa", async () => {
    const r = await pedir("GET", "/empresa/minhas-permissoes", await entrar("fina@teste.invalid"));
    expect(r.json()).toMatchObject({
      perfil: "funcionario",
      area: "financeiro",
      modulos: {
        pessoas: { acoes: { ver: "meus", excluir: "nada" }, verSensiveis: false },
        permissoes: { acoes: { editar: "nada" } },
      },
    });
  });

  it("sem sessão, 401; sessão que ainda precisa do 2FA, 403", async () => {
    expect((await pedir("GET", "/empresa/pessoas", "")).statusCode).toBe(401);
    const cookie = await entrar("ana@teste.invalid");
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = null where pessoa_id = (select id from pessoas where email = 'ana@teste.invalid')",
    );
    const r = await pedir("GET", "/empresa/pessoas", cookie);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("DOIS_FATORES_CONFIRMAR");
  });

  it("auditoria: a administradora vê os eventos da empresa (entradas e mudanças de permissão); o funcionário não", async () => {
    const ana = await entrar("ana@teste.invalid");
    const todos = await pedir("GET", "/empresa/auditoria?limite=500", ana);
    expect(todos.statusCode).toBe(200);
    const acoes = new Set(todos.json().map((e: { acao: string }) => e.acao));
    expect(acoes.has("acesso.entrou")).toBe(true);
    expect(acoes.has("permissao.alterou")).toBe(true);
    const so = await pedir("GET", "/empresa/auditoria?acao=permissao", ana);
    expect(so.json().length).toBeGreaterThan(0);
    expect(so.json().every((e: { acao: string }) => e.acao.startsWith("permissao."))).toBe(true);
    expect(so.json()[0].detalhes).toHaveProperty("modulo");
    expect((await pedir("GET", "/empresa/auditoria", await entrar("fabio@teste.invalid"))).statusCode).toBe(
      403,
    );
  });

  it("telas do administrador: vê as permissões calculadas de uma pessoa, com os ajustes", async () => {
    const ana = await entrar("ana@teste.invalid");
    const lista = (await pedir("GET", "/empresa/pessoas", ana)).json();
    const fabio = lista.find((p: { nome: string }) => p.nome === "Fabio Func");
    expect(fabio.vinculoId).toBe(vinculos["fabio@teste.invalid"]);
    const r = await pedir("GET", `/empresa/pessoas/${fabio.vinculoId}/permissoes`, ana);
    expect(r.statusCode).toBe(200);
    const pessoas = r.json().modulos.find((m: { id: string }) => m.id === "pessoas");
    expect(pessoas.permissao.acoes.ver).toBe("equipe");
    expect(pessoas.ajustes).toMatchObject({ ver: "equipe" });
    expect(
      (
        await pedir(
          "GET",
          `/empresa/pessoas/${fabio.vinculoId}/permissoes`,
          await entrar("fabio@teste.invalid"),
        )
      ).statusCode,
    ).toBe(403);
  });

  it("segurança da empresa: só o administrador vê e muda", async () => {
    const ana = await entrar("ana@teste.invalid");
    expect((await pedir("GET", "/empresa/seguranca", ana)).json()).toEqual({
      exigirDoisFatores: false,
      exigirPasskey: false,
    });
    expect(
      (await pedir("PUT", "/empresa/seguranca", ana, { exigirDoisFatores: true, exigirPasskey: false }))
        .statusCode,
    ).toBe(200);
    expect((await pedir("GET", "/empresa/seguranca", ana)).json().exigirDoisFatores).toBe(true);
    const gil = await entrar("gil@teste.invalid");
    expect(
      (await pedir("PUT", "/empresa/seguranca", gil, { exigirDoisFatores: false, exigirPasskey: false }))
        .statusCode,
    ).toBe(403);
    await pedir("PUT", "/empresa/seguranca", ana, { exigirDoisFatores: false, exigirPasskey: false });
  });
});
