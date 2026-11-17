/**
 * Login por e-mail e senha (M1-03), de ponta a ponta: API (Fastify + Better Auth) e banco de verdade.
 * A checagem de senhas vazadas fica desligada aqui (ela consulta a internet); o resto é o que roda no teste.
 */
import {
  type Carteiro,
  criarLogin,
  criarPoolDoLogin,
  gerarLinkDeSenha,
  registrarRotasDoLogin,
} from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { iniciarPlataforma } from "@mago-os/nucleo/plataforma";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("login por e-mail e senha", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let login: ReturnType<typeof criarLogin>;
  const links: string[] = [];
  let ipDaVez = 0;

  const carteiro: Carteiro = {
    async enviarLinkDeSenha({ link }) {
      links.push(link);
    },
  };

  /** Cada teste usa um IP próprio, para o limite por minuto de um não atrapalhar o outro. */
  function novoIp(): string {
    ipDaVez += 1;
    return `203.0.113.${ipDaVez}`;
  }

  function pedir(caminho: string, corpo: unknown, ip: string, cookie?: string) {
    return app.inject({
      method: corpo === undefined ? "GET" : "POST",
      url: `/acesso${caminho}`,
      headers: {
        origin: SITE,
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  }

  async function definirSenha(email: string, senha: string, ip: string) {
    links.length = 0;
    const pedido = await pedir("/request-password-reset", { email }, ip);
    expect(pedido.statusCode).toBe(200);
    const token = new URL(links[0] ?? "").searchParams.get("token");
    return pedir("/reset-password", { newPassword: senha, token }, ip);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    await iniciarPlataforma(dono, {
      nome: "Pessoa Dona",
      email: "dona@teste.invalid",
      empresa: "Empresa Um",
    });
    pool = criarPoolDoLogin(banco.urlAcesso);
    login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro,
      },
      pool,
    );
    app = Fastify();
    registrarRotasDoLogin(app, login, pool);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("o primeiro acesso: o link define a senha, e a pessoa entra com a empresa já escolhida", async () => {
    const ip = novoIp();
    expect(links).toEqual([]);
    const definida = await definirSenha("dona@teste.invalid", SENHA, ip);
    expect(definida.statusCode).toBe(200);
    expect(links[0]).toMatch(/^https:\/\/teste\.osmago\.invalid\/redefinir-senha\?token=/);

    const entrada = await pedir("/sign-in/email", { email: "Dona@Teste.invalid", password: SENHA }, ip);
    expect(entrada.statusCode).toBe(200);
    const cookie = String(entrada.headers["set-cookie"]).split(";")[0] ?? "";
    expect(cookie).toMatch(/^mago\.session_token=/);
    expect(String(entrada.headers["set-cookie"])).toMatch(/HttpOnly/i);

    const sessao = await pedir("/get-session", undefined, ip, cookie);
    const corpo = sessao.json();
    expect(corpo.user.email).toBe("dona@teste.invalid");
    const empresa = await dono.query("select id from empresas where nome = 'Empresa Um'");
    expect(corpo.session.empresaId).toBe(empresa.rows[0].id);
    expect(corpo.session.ipAddress).toBe(ip);

    const senhaGuardada = await dono.query("select senha from acesso.credenciais");
    expect(senhaGuardada.rows[0].senha).not.toContain(SENHA);

    const saida = await pedir("/sign-out", {}, ip, cookie);
    expect(saida.statusCode).toBe(200);
    expect((await pedir("/get-session", undefined, ip, cookie)).json()).toBeNull();
  });

  it("o link de senha só vale uma vez e o banco guarda só a impressão digital dele", async () => {
    const ip = novoIp();
    links.length = 0;
    await pedir("/request-password-reset", { email: "dona@teste.invalid" }, ip);
    const token = new URL(links[0] ?? "").searchParams.get("token") ?? "";
    const guardado = await dono.query("select identificador from acesso.verificacoes");
    expect(guardado.rows.map((r) => r.identificador).join()).not.toContain(token);
    expect((await pedir("/reset-password", { newPassword: SENHA, token }, ip)).statusCode).toBe(200);
    expect((await pedir("/reset-password", { newPassword: SENHA, token }, ip)).statusCode).toBe(400);
  });

  it("senha curta demais é recusada", async () => {
    const r = await definirSenha("dona@teste.invalid", "curta", novoIp());
    expect(r.statusCode).toBe(400);
  });

  it("não existe cadastro aberto", async () => {
    const r = await pedir(
      "/sign-up/email",
      { email: "intrusa@teste.invalid", password: SENHA, name: "Intrusa" },
      novoIp(),
    );
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    const pessoas = await dono.query(
      "select count(*)::int as n from pessoas where email = 'intrusa@teste.invalid'",
    );
    expect(pessoas.rows[0].n).toBe(0);
  });

  it("e-mail que não existe recebe a mesma resposta que senha errada", async () => {
    const ip = novoIp();
    const semConta = await pedir("/sign-in/email", { email: "ninguem@teste.invalid", password: SENHA }, ip);
    const senhaErrada = await pedir(
      "/sign-in/email",
      { email: "dona@teste.invalid", password: "errada123456" },
      ip,
    );
    expect(semConta.statusCode).toBe(401);
    expect(senhaErrada.statusCode).toBe(401);
    expect(semConta.json()).toEqual(senhaErrada.json());
    await dono.query("delete from acesso.travas");
  });

  it("depois de 5 senhas erradas seguidas, trava por 15 minutos, mesmo com a senha certa", async () => {
    const ip = novoIp();
    for (let i = 0; i < 5; i++) {
      const r = await pedir(
        "/sign-in/email",
        { email: "dona@teste.invalid", password: `errada-${i}-xxxx` },
        ip,
      );
      expect(r.statusCode).toBe(401);
    }
    const travada = await pedir("/sign-in/email", { email: "dona@teste.invalid", password: SENHA }, novoIp());
    expect(travada.statusCode).toBe(429);
    expect(travada.json().message).toMatch(/Tente de novo em 15 minutos/);
    await dono.query("delete from acesso.travas");
    const liberada = await pedir(
      "/sign-in/email",
      { email: "dona@teste.invalid", password: SENHA },
      novoIp(),
    );
    expect(liberada.statusCode).toBe(200);
  });

  it("acertar a senha zera a contagem de erros", async () => {
    const ip = novoIp();
    for (let i = 0; i < 4; i++)
      await pedir("/sign-in/email", { email: "dona@teste.invalid", password: "errada123456" }, ip);
    await pedir("/sign-in/email", { email: "dona@teste.invalid", password: SENHA }, ip);
    const r = await dono.query("select count(*)::int as n from acesso.travas");
    expect(r.rows[0].n).toBe(0);
  });

  it("cada endereço de internet tenta no máximo 10 vezes por minuto", async () => {
    const ip = novoIp();
    const codigos: number[] = [];
    for (let i = 0; i < 11; i++) {
      const email = `outra${i}@teste.invalid`;
      codigos.push((await pedir("/sign-in/email", { email, password: "errada123456" }, ip)).statusCode);
    }
    expect(codigos.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codigos[10]).toBe(429);
    await dono.query("delete from acesso.travas");
  });

  it("pessoa bloqueada não entra, mesmo com a senha certa", async () => {
    await dono.query("update pessoas set situacao = 'bloqueada' where email = 'dona@teste.invalid'");
    const r = await pedir("/sign-in/email", { email: "dona@teste.invalid", password: SENHA }, novoIp());
    await dono.query("update pessoas set situacao = 'ativa' where email = 'dona@teste.invalid'");
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("ACESSO_BLOQUEADO");
  });

  it("trocar a senha pelo link derruba as sessões abertas", async () => {
    const ip = novoIp();
    const entrada = await pedir("/sign-in/email", { email: "dona@teste.invalid", password: SENHA }, ip);
    const cookie = String(entrada.headers["set-cookie"]).split(";")[0] ?? "";
    expect((await pedir("/get-session", undefined, ip, cookie)).json()).not.toBeNull();
    await definirSenha("dona@teste.invalid", `${SENHA} nova`, ip);
    expect((await pedir("/get-session", undefined, ip, cookie)).json()).toBeNull();
    await definirSenha("dona@teste.invalid", SENHA, ip);
  });

  it("o papel da API (mago_app) não lê senhas nem sessões", async () => {
    const app2 = new pg.Client({ connectionString: banco.urlApp });
    await app2.connect();
    await expect(app2.query("select * from acesso.sessoes")).rejects.toThrow(/permission denied/);
    await expect(app2.query("select * from acesso.credenciais")).rejects.toThrow(/permission denied/);
    await app2.end();
  });

  it("o comando do primeiro acesso gera o link, e recusa e-mail sem pessoa", async () => {
    const link = await gerarLinkDeSenha(login, links, " DONA@teste.invalid ");
    expect(link).toMatch(/\/redefinir-senha\?token=/);
    await expect(gerarLinkDeSenha(login, links, "ninguem@teste.invalid")).rejects.toThrow(/Não há pessoa/);
  });
});
