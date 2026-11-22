/**
 * Telegram (M5-01, decisão 0032): webhook com segredo, vínculo por código, uma conta por pessoa, /empresa, /sair,
 * travas, e o vínculo que cai com o desligamento. Com o Telegram falso (sem rede).
 */
import type { AtualizacaoDoTelegram } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  type CarteiroFalsoDoTelegram,
  carteiroFalsoDoTelegram,
  registrarRotasDoTelegram,
  tratarAtualizacao,
} from "@mago-os/nucleo/telegram";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-do-webhook-de-teste-com-32-ou-mais";
const OUTRA = "00000000-0000-7000-8000-0000000000c1";
const SILENCIO = { info() {}, warn() {}, error() {} };

describe.skipIf(!bancoDisponivel)("Telegram", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let carteiro: CarteiroFalsoDoTelegram;
  let empresaId: string;
  let ip = 0;
  let numero = 1000;
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function criarPessoa(nome: string, email: string, perfil: string, empresa = empresaId) {
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
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, 'ativo', now(), now())`,
      [empresa, id, perfil],
    );
    return id;
  }

  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.20.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    await dono.query(
      // Quem está em duas empresas entra sem empresa escolhida: a sessão de teste já começa na 4xpert.
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey', empresa_id = coalesce(empresa_id, $2) where pessoa_id = (select id from pessoas where email = $1)",
      [email, empresaId],
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
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const pedir = (metodo: "GET" | "POST" | "DELETE", url: string, cookie: string) =>
    app.inject({ method: metodo, url, headers: { cookie, origin: SITE } });

  /** Uma mensagem individual de uma conta do Telegram, entregue pelo webhook com o segredo. */
  function mandar(conta: number, texto: string, tipo = "private", segredo: string | null = SEGREDO) {
    numero += 1;
    const atualizacao = {
      update_id: numero,
      message: {
        message_id: numero,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tipo === "private" ? conta : -conta, type: tipo },
        from: { id: conta, is_bot: false, first_name: `Conta ${conta}`, username: `conta${conta}` },
        text: texto,
      },
    };
    return app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "content-type": "application/json",
        ...(segredo ? { "x-telegram-bot-api-secret-token": segredo } : {}),
      },
      payload: JSON.stringify(atualizacao),
    });
  }
  const ultima = (chatId: number) => carteiro.enviadas.filter((m) => m.chatId === chatId).at(-1)?.texto ?? "";

  async function codigoDe(email: string): Promise<string> {
    const r = await pedir("POST", "/conta/telegram/codigo", await como(email));
    expect(r.statusCode).toBe(200);
    const corpo = r.json() as { codigo: string; link: string };
    expect(corpo.link).toBe(`https://t.me/OsMagoTesteBot?start=${corpo.codigo}`);
    return corpo.codigo;
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id");
    empresaId = e.rows[0]?.id as string;
    await dono.query("insert into empresas (id, nome) values ($1, 'Nolask')", [OUTRA]);
    ids.sandro = await criarPessoa("Sandro Nolasco", "sandro@teste.invalid", "administrador");
    await dono.query(
      "insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) values ($1, $2, 'administrador', 'ativo', now(), now())",
      [OUTRA, ids.sandro],
    );
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", OUTRA);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} },
      },
      poolAcesso,
    );
    carteiro = carteiroFalsoDoTelegram();
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    registrarRotasDoTelegram(app, {
      login,
      poolAcesso,
      poolApp,
      bot: { carteiro, segredo: SEGREDO, usuario: () => "OsMagoTesteBot" },
      // Nos testes, a mensagem é tratada na hora (na API, vai para a fila).
      receber: (a: AtualizacaoDoTelegram) => tratarAtualizacao({ poolApp, carteiro, log: SILENCIO }, a),
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

  beforeEach(() => {
    carteiro.enviadas.length = 0;
  });

  it("o webhook sem o segredo certo é recusado e nada é lido", async () => {
    expect((await mandar(111, "/start AAAAAAAA", "private", null)).statusCode).toBe(401);
    expect(
      (await mandar(111, "/start AAAAAAAA", "private", "outro-segredo-qualquer-com-32-letras!")).statusCode,
    ).toBe(401);
    expect(carteiro.enviadas).toEqual([]);
  });

  it("conta sem vínculo recebe só a resposta fixa", async () => {
    expect((await mandar(111, "oi")).statusCode).toBe(200);
    expect(ultima(111)).toBe("Para usar o Mago OS pelo Telegram, vincule a conta em Meu perfil, no app.");
  });

  it("vincula pelo link do código e responde com o nome e a empresa", async () => {
    const codigo = await codigoDe("sandro@teste.invalid");
    await mandar(222, `/start ${codigo}`);
    expect(ultima(222)).toMatch(/^Pronto, Sandro\. Você está na 4xpert\./);
    const s = (await pedir("GET", "/conta/telegram", await como("sandro@teste.invalid"))).json();
    expect(s).toMatchObject({
      botLigado: true,
      bot: "OsMagoTesteBot",
      vinculo: { usuario: "conta222", nome: "Conta 222", empresa: { id: empresaId, nome: "4xpert" } },
    });
    const ev = await dono.query("select 1 from auditoria.eventos where acao = 'telegram.vinculou'");
    expect(ev.rowCount).toBe(1);
  });

  it("o código serve uma vez só, e gerar outro anula o anterior", async () => {
    const primeiro = await codigoDe("ana@teste.invalid");
    const segundo = await codigoDe("ana@teste.invalid");
    await mandar(333, primeiro);
    expect(ultima(333)).toMatch(/^Esse código não vale/);
    await mandar(333, segundo.toLowerCase().replace(/(....)/, "$1-"));
    expect(ultima(333)).toMatch(/^Pronto, Ana\./);
    await mandar(334, `/start ${segundo}`);
    expect(ultima(334)).toMatch(/^Esse código não vale/);
  });

  it("código vencido não vale", async () => {
    const codigo = await codigoDe("flora@teste.invalid");
    await dono.query(
      "update codigos_do_telegram set criado_em = now() - interval '20 minutes', vence_em = now() - interval '1 minute' where usado_em is null",
    );
    await mandar(444, codigo);
    expect(ultima(444)).toMatch(/^Esse código não vale/);
  });

  it("cinco códigos errados travam a conta do Telegram por 15 minutos", async () => {
    for (let i = 0; i < 4; i++) {
      await mandar(555, "ZZZZZZZZ");
      expect(ultima(555)).toMatch(/^Esse código não vale/);
    }
    await mandar(555, "ZZZZZZZZ");
    expect(ultima(555)).toMatch(/^Muitos códigos errados/);
    const codigo = await codigoDe("flora@teste.invalid");
    await mandar(555, codigo);
    expect(ultima(555)).toMatch(/^Muitos códigos errados/);
  });

  it("grupo recebe a resposta fixa e o bot sai", async () => {
    await mandar(666, "oi", "group");
    expect(ultima(-666)).toBe("O Mago OS só conversa com você em particular, não em grupos.");
    expect(carteiro.saiuDe).toContain(-666);
  });

  it("a mesma conta vinculada a outra pessoa sai da primeira, que é avisada no app", async () => {
    const codigo = await codigoDe("flora@teste.invalid");
    await mandar(222, codigo);
    expect(ultima(222)).toMatch(/^Pronto, Flora\./);
    const s = (await pedir("GET", "/conta/telegram", await como("sandro@teste.invalid"))).json();
    expect(s.vinculo).toBeNull();
    const aviso = await dono.query(
      "select 1 from avisos where pessoa_id = $1 and tipo = 'telegram_desvinculado'",
      [ids.sandro],
    );
    expect(aviso.rowCount).toBe(1);
  });

  it("/empresa lista as empresas da pessoa e troca", async () => {
    const codigo = await codigoDe("sandro@teste.invalid");
    await mandar(777, codigo);
    await mandar(777, "/empresa");
    expect(ultima(777)).toMatch(/1\. 4xpert \(agora\)\n2\. Nolask$/);
    await mandar(777, "/empresa 2");
    expect(ultima(777)).toBe("Pronto. Agora você está na Nolask.");
    await mandar(777, "/ajuda");
    expect(ultima(777)).toMatch(/^Oi, Sandro\. Você está na Nolask\./);
    // A Flora só está numa empresa.
    await mandar(222, "/empresa");
    expect(ultima(222)).toBe("Você só está na 4xpert.");
  });

  it("uma empresa não vê o vínculo do Telegram da outra", async () => {
    const r = await poolApp.connect();
    try {
      await r.query("begin");
      await r.query(
        "select set_config('mago.empresa_id', $1, true), set_config('mago.pessoa_id', $2, true)",
        [OUTRA, ids.otto],
      );
      const v = await r.query<{ pessoa_id: string }>("select pessoa_id from vinculos_do_telegram");
      // O Otto vê só o vínculo do Sandro, que agora conversa na Nolask; nunca o da Flora, que é da 4xpert.
      expect(v.rows.map((x) => x.pessoa_id)).toEqual([ids.sandro]);
      await r.query("rollback");
    } finally {
      r.release();
    }
  });

  it("/sair desvincula, e a conta volta a receber só a resposta fixa", async () => {
    await mandar(777, "/sair");
    expect(ultima(777)).toBe("Pronto, este Telegram não está mais ligado ao Mago OS.");
    await mandar(777, "oi");
    expect(ultima(777)).toMatch(/^Para usar o Mago OS pelo Telegram/);
  });

  it("desvincular pelo app avisa no Telegram", async () => {
    const codigo = await codigoDe("ana@teste.invalid");
    await mandar(888, codigo);
    const r = await pedir("DELETE", "/conta/telegram", await como("ana@teste.invalid"));
    expect(r.statusCode).toBe(200);
    expect(ultima(888)).toBe("Pronto, este Telegram não está mais ligado ao Mago OS.");
  });

  it("o funcionário desligado perde o vínculo do Telegram", async () => {
    await mandar(222, "/ajuda");
    expect(ultima(222)).toMatch(/^Oi, Flora/);
    await dono.query(
      "update vinculos set situacao = 'desligado', desligado_em = now() where pessoa_id = $1 and empresa_id = $2",
      [ids.flora, empresaId],
    );
    const v = await dono.query("select 1 from vinculos_do_telegram where pessoa_id = $1", [ids.flora]);
    expect(v.rowCount).toBe(0);
    await mandar(222, "/ajuda");
    expect(ultima(222)).toMatch(/^Para usar o Mago OS pelo Telegram/);
  });

  it("a mesma atualização entregue duas vezes é tratada uma vez só", async () => {
    const corpo = JSON.stringify({
      update_id: 99999,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 999, type: "private" },
        from: { id: 999, is_bot: false, first_name: "X" },
        text: "oi",
      },
    });
    const headers = { "content-type": "application/json", "x-telegram-bot-api-secret-token": SEGREDO };
    await app.inject({ method: "POST", url: "/telegram/webhook", headers, payload: corpo });
    await app.inject({ method: "POST", url: "/telegram/webhook", headers, payload: corpo });
    expect(carteiro.enviadas.filter((m) => m.chatId === 999)).toHaveLength(1);
  });
});
