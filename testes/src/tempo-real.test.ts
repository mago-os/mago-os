/**
 * Tempo real (M2-06), de ponta a ponta: o WebSocket de verdade (injectWS), avisos vindos do PostgreSQL
 * (LISTEN/NOTIFY), só para a empresa ativa, e a conexão que cai quando a sessão deixa de valer.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import { registrarTempoReal } from "@mago-os/nucleo/tempo-real";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("tempo real", () => {
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
    await registrarTempoReal(app, {
      login,
      poolAcesso,
      poolApp,
      verificador,
      bancoUrl: banco.urlApp,
      conferirSessaoACada: 300,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  type Mensagens = { avisos: unknown[]; fechou: Promise<number> };
  async function conectar(cookie: string): Promise<Mensagens & { fechar(): void }> {
    const ws = await app.injectWS("/tempo-real", { headers: { cookie, origin: SITE } });
    const avisos: unknown[] = [];
    ws.on("message", (dados: Buffer) => avisos.push(JSON.parse(dados.toString())));
    const fechou = new Promise<number>((ok) => ws.on("close", (codigo: number) => ok(codigo)));
    return { avisos, fechou, fechar: () => ws.terminate() };
  }
  const esperar = async (condicao: () => boolean, ms = 3000) => {
    const ate = Date.now() + ms;
    while (!condicao() && Date.now() < ate) await new Promise((ok) => setTimeout(ok, 20));
    return condicao();
  };

  it("avisa a empresa da tarefa em menos de 2 segundos, e a outra empresa não recebe nada", async () => {
    const ana = await entrar("ana@teste.invalid");
    const otto = await entrar("otto@teste.invalid");
    const daAna = await conectar(ana);
    const doOtto = await conectar(otto);
    const inicio = Date.now();
    const t = await pedir("POST", "/tarefas", ana, { titulo: "Avisar em tempo real" });
    const id = t.json().id;
    expect(await esperar(() => daAna.avisos.some((a) => (a as { id: string }).id === id))).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(daAna.avisos[0]).toEqual({ tipo: "tarefa", id, operacao: "insert" });

    await pedir("POST", `/tarefas/${id}/comentarios`, ana, { texto: "Oi" });
    expect(await esperar(() => daAna.avisos.length >= 3)).toBe(true);
    // O aviso não leva texto nenhum: só tipo, id e operação.
    expect(JSON.stringify(daAna.avisos)).not.toContain("Oi");
    expect(JSON.stringify(daAna.avisos)).not.toContain("Avisar em tempo real");

    await new Promise((ok) => setTimeout(ok, 300));
    expect(doOtto.avisos).toEqual([]);
    daAna.fechar();
    doOtto.fechar();
  });

  it("sem sessão, a conexão é recusada", async () => {
    const semSessao = await conectar("");
    expect(await semSessao.fechou).toBe(4401);
  });

  it("a conexão cai quando a sessão deixa de valer", async () => {
    const fabio = await entrar("fabio@teste.invalid");
    const c = await conectar(fabio);
    await dono.query(
      "delete from acesso.sessoes where pessoa_id = (select id from pessoas where email = 'fabio@teste.invalid')",
    );
    expect(await c.fechou).toBe(4401);
  });
});
