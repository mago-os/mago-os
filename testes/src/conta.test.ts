/**
 * Conta da própria pessoa (M1-10): meu perfil, minhas empresas e trocar a empresa ativa.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDaConta } from "@mago-os/nucleo/conta";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const C = "00000000-0000-7000-8000-00000000000c";

describe.skipIf(!bancoDisponivel)("conta da pessoa", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let cookie = "";

  const pedir = (metodo: "GET" | "PUT" | "POST", url: string, corpo?: unknown) =>
    app.inject({
      method: metodo,
      url,
      headers: { cookie, origin: SITE, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    await dono.query(
      "insert into empresas (id, nome) values ($1, 'Empresa A'), ($2, 'Empresa B'), ($3, 'Empresa C')",
      [A, B, C],
    );
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Duda', 'duda@teste.invalid', true) returning id",
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    for (const empresa of [A, B]) {
      await dono.query(
        "insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) values ($1, $2, 'funcionario', 'ativo', now(), now())",
        [empresa, id],
      );
    }
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
    registrarRotasDaConta(app, login, poolAcesso, poolApp);
    await app.ready();
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json" },
      payload: JSON.stringify({ email: "duda@teste.invalid", password: SENHA }),
    });
    cookie = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("lista só as empresas onde a pessoa está ativa; com duas, nenhuma vem escolhida", async () => {
    const r = await pedir("GET", "/conta/empresas");
    expect(r.json().map((e: { nome: string }) => e.nome)).toEqual(["Empresa A", "Empresa B"]);
    expect(r.json().every((e: { ativa: boolean }) => !e.ativa)).toBe(true);
  });

  it("troca a empresa ativa, e recusa empresa sem vínculo", async () => {
    expect((await pedir("POST", "/conta/empresa-ativa", { empresaId: B })).statusCode).toBe(200);
    const r = await pedir("GET", "/conta/empresas");
    expect(r.json().find((e: { ativa: boolean }) => e.ativa)?.nome).toBe("Empresa B");
    expect((await pedir("POST", "/conta/empresa-ativa", { empresaId: C })).statusCode).toBe(403);
    const eventos = await dono.query(
      "select count(*)::int as n from auditoria.eventos where acao = 'empresa.trocou_ativa'",
    );
    expect(eventos.rows[0].n).toBe(1);
  });

  it("meu perfil: lê e muda nome, idioma e fuso; recusa valores inválidos", async () => {
    const antes = (await pedir("GET", "/conta/perfil")).json();
    expect(antes).toMatchObject({
      nome: "Duda",
      email: "duda@teste.invalid",
      temSenha: true,
      googleLigado: false,
    });
    const muda = await pedir("PUT", "/conta/perfil", {
      nome: " Duda Silva ",
      idioma: "pt-BR",
      fusoHorario: "Europe/Lisbon",
    });
    expect(muda.statusCode).toBe(200);
    expect((await pedir("GET", "/conta/perfil")).json()).toMatchObject({
      nome: "Duda Silva",
      fusoHorario: "Europe/Lisbon",
    });
    const ruim = await pedir("PUT", "/conta/perfil", { nome: "", idioma: "portugues", fusoHorario: "x" });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().campos).toEqual(["nome", "idioma", "fusoHorario"]);
  });

  it("sem sessão, 401", async () => {
    const r = await app.inject({ method: "GET", url: "/conta/perfil" });
    expect(r.statusCode).toBe(401);
  });

  it("piso da plataforma: só o Dono vê e muda", async () => {
    expect((await pedir("GET", "/plataforma/regras")).statusCode).toBe(403);
    await dono.query(
      "insert into papeis_plataforma (pessoa_id, papel) select id, 'dono' from pessoas where email = 'duda@teste.invalid'",
    );
    // Dono precisa de 2FA: uma passkey e a sessão confirmada (o 2FA tem testes próprios).
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', 'duda', 'multiDevice' from pessoas where email = 'duda@teste.invalid'",
    );
    await dono.query("update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey'");
    expect((await pedir("GET", "/plataforma/regras")).json()).toEqual({
      exigirPasskeyAdministradores: false,
    });
    expect(
      (await pedir("PUT", "/plataforma/regras", { exigirPasskeyAdministradores: true })).statusCode,
    ).toBe(200);
    const r = await dono.query("select exigir_passkey_administradores as v from acesso.regras_da_plataforma");
    expect(r.rows[0].v).toBe(true);
    expect((await pedir("GET", "/conta/perfil")).json().donoDaPlataforma).toBe(true);
  });
});
