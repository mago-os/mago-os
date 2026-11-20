/**
 * Dados da empresa (M3-11): todos veem, só o administrador muda; CPF mascarado para quem não administra; mudar o
 * documento pede o segundo fator recente; a mudança vira empresa.alterou sem dado pessoal nos detalhes.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDosDadosDaEmpresa } from "@mago-os/nucleo/dados-da-empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000b2";

describe.skipIf(!bancoDisponivel)("dados da empresa", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.11.${ip}` },
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
    registrarRotasDosDadosDaEmpresa(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const BASE = {
    nome: "Empresa Um",
    tipo: null,
    documento: null,
    nomeLegal: null,
    fusoHorario: "America/Sao_Paulo",
    idioma: "pt-BR",
    telefone: null,
  };
  const CPF = "52998224725";

  it("só o administrador muda; o fuso vale e vira empresa.alterou, sem dado pessoal nos detalhes", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    expect((await pedir("GET", "/empresa/dados", flora)).json()).toMatchObject({
      nome: "Empresa Um",
      podeEditar: false,
    });
    expect((await pedir("POST", "/empresa/dados", flora, { ...BASE, nome: "Outra" })).statusCode).toBe(403);
    const r = await pedir("POST", "/empresa/dados", ana, {
      ...BASE,
      fusoHorario: "Europe/Lisbon",
      telefone: "+351 912 345 678",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ fusoHorario: "Europe/Lisbon", podeEditar: true });
    const ev = await dono.query<{ detalhes: Record<string, unknown> }>(
      "select detalhes from auditoria.eventos where empresa_id = $1 and acao = 'empresa.alterou' order by sequencia desc limit 1",
      [empresaId],
    );
    expect(ev.rows[0]?.detalhes).toEqual({
      campos: ["fusoHorario", "telefone"],
      fusoHorario: "Europe/Lisbon",
    });
    expect(
      (await pedir("POST", "/empresa/dados", ana, { ...BASE, fusoHorario: "Lua/Base" })).statusCode,
    ).toBe(400);
  });

  it("mudar o documento pede o segundo fator recente; o CPF aparece mascarado para quem não administra", async () => {
    const ana = await como("ana@teste.invalid");
    // A confirmação do segundo fator ficou velha (mais de 10 minutos).
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now() - interval '1 hour' where pessoa_id = $1",
      [ids.ana],
    );
    const pf = { ...BASE, tipo: "pf", documento: CPF, nomeLegal: "Ana Admin da Silva" };
    expect((await pedir("POST", "/empresa/dados", ana, pf)).statusCode).toBe(403);
    await dono.query("update acesso.sessoes set dois_fatores_em = now() where pessoa_id = $1", [ids.ana]);
    expect((await pedir("POST", "/empresa/dados", ana, pf)).statusCode).toBe(200);
    expect((await pedir("GET", "/empresa/dados", ana)).json().documento).toBe(CPF);
    const visto = (await pedir("GET", "/empresa/dados", await como("flora@teste.invalid"))).json().documento;
    expect(visto).toMatch(/^\*\*\*\./);
    const ev = await dono.query<{ detalhes: Record<string, unknown> }>(
      "select detalhes from auditoria.eventos where empresa_id = $1 and acao = 'empresa.alterou' order by sequencia desc limit 1",
      [empresaId],
    );
    expect(JSON.stringify(ev.rows[0]?.detalhes)).not.toContain(CPF);
    expect(JSON.stringify(ev.rows[0]?.detalhes)).not.toContain("Silva");
  });
});
