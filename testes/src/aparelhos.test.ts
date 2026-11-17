/**
 * Sessões e aparelhos (M1-08), de ponta a ponta: cada "aparelho" é um pote de cookies separado.
 */
import {
  criarLogin,
  criarPoolDoLogin,
  embaralharSenha,
  nomeDoAparelho,
  registrarRotasDoLogin,
} from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0";

/** Um aparelho: guarda os cookies que recebe, como o navegador faz. */
class Aparelho {
  cookies = new Map<string, string>();
  readonly navegador: string;
  readonly ip: string;
  constructor(navegador: string, ip: string) {
    this.navegador = navegador;
    this.ip = ip;
  }
  cabecalho() {
    return [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  }
  guardar(r: { headers: Record<string, unknown> }) {
    for (const c of ([] as string[]).concat(
      (r.headers["set-cookie"] as string[] | string | undefined) ?? [],
    )) {
      const [par] = c.split(";");
      const [nome, ...resto] = (par ?? "").split("=");
      const valor = resto.join("=");
      if (!nome) continue;
      if (valor === "" || /max-age=0/i.test(c)) this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }
  }
}

describe.skipIf(!bancoDisponivel)("sessões e aparelhos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let pool: pg.Pool;
  let app: FastifyInstance;

  async function pedir(aparelho: Aparelho, metodo: "GET" | "POST", url: string, corpo?: unknown) {
    const r = await app.inject({
      method: metodo,
      url,
      headers: {
        origin: SITE,
        "user-agent": aparelho.navegador,
        "x-forwarded-for": aparelho.ip,
        cookie: aparelho.cabecalho(),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
    aparelho.guardar(r);
    return r;
  }

  const entrar = (aparelho: Aparelho, email = "func@teste.invalid") =>
    pedir(aparelho, "POST", "/acesso/sign-in/email", { email, password: SENHA });

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    for (const email of ["func@teste.invalid", "outra@teste.invalid"]) {
      const p = await dono.query<{ id: string }>(
        "insert into pessoas (nome, email, email_verificado) values ('Pessoa', $1, true) returning id",
        [email],
      );
      await dono.query(
        "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
        [p.rows[0]?.id, p.rows[0]?.id, await embaralharSenha(SENHA)],
      );
    }
    pool = criarPoolDoLogin(banco.urlAcesso);
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {} },
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

  it("dá nome legível ao aparelho", () => {
    expect(nomeDoAparelho(MAC)).toBe("Chrome no Mac");
    expect(nomeDoAparelho(IPHONE)).toBe("Safari no iPhone");
    expect(nomeDoAparelho(WINDOWS)).toBe("Edge no Windows");
    expect(nomeDoAparelho(null)).toBe("Aparelho desconhecido");
  });

  const mac = new Aparelho(MAC, "203.0.113.10");
  const iphone = new Aparelho(IPHONE, "203.0.113.20");

  it("o primeiro aparelho não gera aviso; entrar de novo nele também não", async () => {
    expect((await entrar(mac)).statusCode).toBe(200);
    expect(mac.cookies.has("mago_aparelho")).toBe(true);
    expect((await entrar(mac)).statusCode).toBe(200);
    const avisos = await dono.query("select count(*)::int as n from acesso.avisos");
    expect(avisos.rows[0].n).toBe(0);
    // Entrar de novo no mesmo aparelho não deixa sessão sobrando.
    const sessoes = await dono.query(
      "select count(*)::int as n from acesso.sessoes where ip = '203.0.113.10'",
    );
    expect(sessoes.rows[0].n).toBe(1);
    const etiquetas = await dono.query("select etiqueta from acesso.aparelhos");
    expect(etiquetas.rows).toHaveLength(1);
    expect(etiquetas.rows[0].etiqueta).not.toBe(mac.cookies.get("mago_aparelho"));
  });

  it("entrar num aparelho novo gera o aviso, que aparece no aparelho conhecido e não no novo", async () => {
    expect((await entrar(iphone)).statusCode).toBe(200);
    const noMac = (await pedir(mac, "GET", "/acesso/avisos")).json();
    expect(noMac).toHaveLength(1);
    expect(noMac[0]).toMatchObject({
      tipo: "aparelho_novo",
      aparelho: "Safari no iPhone",
      ip: "203.0.113.20",
    });
    expect((await pedir(iphone, "GET", "/acesso/avisos")).json()).toEqual([]);
  });

  it("meus aparelhos lista as sessões abertas, com 'este aparelho'", async () => {
    const lista = (await pedir(mac, "GET", "/acesso/aparelhos")).json();
    expect(lista.map((a: { aparelho: string }) => a.aparelho).sort()).toEqual([
      "Chrome no Mac",
      "Safari no iPhone",
    ]);
    expect(lista.filter((a: { esteAparelho: boolean }) => a.esteAparelho)).toHaveLength(1);
  });

  it("desconectar o iPhone pelo Mac derruba o iPhone na hora", async () => {
    const lista = (await pedir(mac, "GET", "/acesso/aparelhos")).json();
    const doIphone = lista.find((a: { aparelho: string }) => a.aparelho === "Safari no iPhone");
    expect(
      (await pedir(mac, "POST", "/acesso/aparelhos/desconectar", { sessaoId: doIphone.sessaoId })).statusCode,
    ).toBe(200);
    expect((await pedir(iphone, "GET", "/acesso/estado")).json()).toBeNull();
  });

  it("ninguém desconecta a sessão de outra pessoa", async () => {
    const outra = new Aparelho(WINDOWS, "203.0.113.30");
    await entrar(outra, "outra@teste.invalid");
    const daOutra = (await pedir(outra, "GET", "/acesso/aparelhos")).json()[0];
    const r = await pedir(mac, "POST", "/acesso/aparelhos/desconectar", { sessaoId: daOutra.sessaoId });
    expect(r.statusCode).toBe(404);
    expect((await pedir(outra, "GET", "/acesso/estado")).json()).not.toBeNull();
  });

  it("desconectar todos os outros deixa só este aparelho", async () => {
    await entrar(iphone);
    const r = await pedir(mac, "POST", "/acesso/aparelhos/desconectar-outros", {});
    expect(r.json().desconectados).toBeGreaterThanOrEqual(1);
    const lista = (await pedir(mac, "GET", "/acesso/aparelhos")).json();
    expect(lista).toHaveLength(1);
    expect(lista[0].esteAparelho).toBe(true);
  });

  it("'não fui eu' desconecta o aparelho estranho e esquece ele", async () => {
    const estranho = new Aparelho(WINDOWS, "198.51.100.66");
    await entrar(estranho);
    const aviso = (await pedir(mac, "GET", "/acesso/avisos"))
      .json()
      .find((a: { aparelho: string }) => a.aparelho === "Edge no Windows");
    const r = await pedir(mac, "POST", "/acesso/avisos/responder", {
      avisoId: aviso.avisoId,
      resposta: "nao_fui_eu",
    });
    expect(r.json().mensagem).toMatch(/troque a sua senha/);
    expect((await pedir(estranho, "GET", "/acesso/estado")).json()).toBeNull();
    expect(
      (await pedir(mac, "GET", "/acesso/avisos"))
        .json()
        .some((a: { avisoId: string }) => a.avisoId === aviso.avisoId),
    ).toBe(false);
    // Se entrar de novo por lá, o aviso volta.
    await entrar(estranho);
    expect(
      (await pedir(mac, "GET", "/acesso/avisos"))
        .json()
        .some((a: { aparelho: string }) => a.aparelho === "Edge no Windows"),
    ).toBe(true);
  });

  it("3 dias sem uso: a sessão cai", async () => {
    const parado = new Aparelho(MAC, "203.0.113.40");
    await entrar(parado);
    await dono.query(
      "update acesso.sessoes set ultimo_uso_em = now() - interval '3 days 1 minute' where ip = '203.0.113.40'",
    );
    expect((await pedir(parado, "GET", "/acesso/estado")).json()).toBeNull();
    const sobrou = await dono.query(
      "select count(*)::int as n from acesso.sessoes where ip = '203.0.113.40'",
    );
    expect(sobrou.rows[0].n).toBe(0);
  });

  it("mesmo em uso, depois de 30 dias pede login de novo", async () => {
    const antigo = new Aparelho(MAC, "203.0.113.50");
    await entrar(antigo);
    await dono.query(
      "update acesso.sessoes set criada_em = now() - interval '31 days' where ip = '203.0.113.50'",
    );
    expect((await pedir(antigo, "GET", "/acesso/estado")).json()).toBeNull();
  });

  it("o uso recente fica registrado (no máximo a cada 5 minutos)", async () => {
    const usado = new Aparelho(MAC, "203.0.113.60");
    await entrar(usado);
    await dono.query(
      "update acesso.sessoes set ultimo_uso_em = now() - interval '1 hour' where ip = '203.0.113.60'",
    );
    await pedir(usado, "GET", "/acesso/estado");
    const r = await dono.query(
      "select (now() - ultimo_uso_em) < interval '1 minute' as recente from acesso.sessoes where ip = '203.0.113.60'",
    );
    expect(r.rows[0].recente).toBe(true);
  });
});
