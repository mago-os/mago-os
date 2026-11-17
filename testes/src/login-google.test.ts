/**
 * Login com Google (M1-04), sem sair do computador: o Google de verdade é trocado por uma resposta falsa
 * no ponto em que o Mago OS troca o código pelo token. O resto (estado, ligação da conta, sessão) é o real.
 */
import { criarLogin, criarPoolDoLogin, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { iniciarPlataforma } from "@mago-os/nucleo/plataforma";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const ID_GOOGLE = "mago-teste.apps.googleusercontent.com";

/** Token de identidade no formato do Google (sem assinatura: o Mago OS o recebe direto do Google, por TLS). */
function tokenDeIdentidade(dados: Record<string, unknown>): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const agora = Math.floor(Date.now() / 1000);
  return `${parte({ alg: "RS256", typ: "JWT" })}.${parte({
    iss: "https://accounts.google.com",
    aud: ID_GOOGLE,
    iat: agora,
    exp: agora + 3600,
    ...dados,
  })}.assinatura`;
}

describe.skipIf(!bancoDisponivel)("login com Google", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let pool: pg.Pool;
  let app: FastifyInstance;
  const fetchDeVerdade = globalThis.fetch;
  let ipDaVez = 0;

  function fingirGoogle(dados: Record<string, unknown>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, opcoes) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Response.json({
          access_token: "token-falso",
          id_token: tokenDeIdentidade(dados),
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile",
        });
      }
      return fetchDeVerdade(entrada, opcoes);
    });
  }

  /** Faz o caminho inteiro: clica em "Entrar com Google", o Google devolve, e o Mago OS responde. */
  async function entrarComGoogle(dados: Record<string, unknown>) {
    ipDaVez += 1;
    const ip = `198.51.100.${ipDaVez}`;
    const inicio = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/social",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": ip },
      payload: JSON.stringify({ provider: "google", callbackURL: `${SITE}/` }),
    });
    expect(inicio.statusCode).toBe(200);
    const paraOGoogle = new URL(inicio.json().url);
    const cookies = ([] as string[])
      .concat(inicio.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    fingirGoogle(dados);
    const volta = await app.inject({
      method: "GET",
      url: `/acesso/callback/google?code=codigo-falso&state=${paraOGoogle.searchParams.get("state")}`,
      headers: { cookie: cookies, "x-forwarded-for": ip },
    });
    return { paraOGoogle, volta };
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
    await dono.query("insert into pessoas (nome, email) values ('Sem Confirmar', 'nova@teste.invalid')");
    pool = criarPoolDoLogin(banco.urlAcesso);
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {} },
        google: { id: ID_GOOGLE, segredo: "segredo-falso" },
      },
      pool,
    );
    app = Fastify();
    registrarRotasDoLogin(app, login, pool);
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("manda para o Google pedindo só nome, e-mail e foto, e com o endereço de volta certo", async () => {
    const inicio = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/social",
      headers: { origin: SITE, "content-type": "application/json" },
      payload: JSON.stringify({ provider: "google", callbackURL: `${SITE}/` }),
    });
    const url = new URL(inicio.json().url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect((url.searchParams.get("scope") ?? "").split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(url.searchParams.get("redirect_uri")).toBe(`${SITE}/api/acesso/callback/google`);
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("a pessoa que já existe entra com a conta Google do mesmo e-mail, e a conta fica ligada", async () => {
    const { volta } = await entrarComGoogle({
      sub: "google-123",
      email: "dona@teste.invalid",
      email_verified: true,
      name: "Outro Nome no Google",
      picture: "https://exemplo.invalid/foto.png",
    });
    expect(volta.statusCode).toBe(302);
    expect(volta.headers.location).toBe(`${SITE}/`);
    expect(String(volta.headers["set-cookie"])).toMatch(/mago\.session_token=/);
    const ligada = await dono.query(
      "select c.provedor, c.conta_no_provedor, p.nome from acesso.credenciais c join pessoas p on p.id = c.pessoa_id where c.provedor = 'google'",
    );
    expect(ligada.rows).toEqual([
      { provedor: "google", conta_no_provedor: "google-123", nome: "Pessoa Dona" },
    ]);
  });

  it("uma conta Google desconhecida não cria pessoa nova", async () => {
    const { volta } = await entrarComGoogle({
      sub: "google-999",
      email: "estranha@teste.invalid",
      email_verified: true,
    });
    expect(volta.statusCode).toBe(302);
    expect(volta.headers.location).toMatch(new RegExp(`^${SITE}/(entrar)?\\?error=`));
    expect(String(volta.headers["set-cookie"] ?? "")).not.toMatch(/session_token=[^;]+/);
    const criada = await dono.query(
      "select count(*)::int as n from pessoas where email = 'estranha@teste.invalid'",
    );
    expect(criada.rows[0].n).toBe(0);
  });

  it("e-mail que o Google não confirmou não liga a conta", async () => {
    const { volta } = await entrarComGoogle({
      sub: "google-456",
      email: "dona@teste.invalid",
      email_verified: false,
    });
    expect(volta.headers.location).toMatch(/error=/);
    const contas = await dono.query(
      "select count(*)::int as n from acesso.credenciais where conta_no_provedor = 'google-456'",
    );
    expect(contas.rows[0].n).toBe(0);
  });

  it("e-mail que o Mago OS ainda não confirmou também não liga a conta", async () => {
    const { volta } = await entrarComGoogle({
      sub: "google-789",
      email: "nova@teste.invalid",
      email_verified: true,
    });
    expect(volta.headers.location).toMatch(/error=/);
    const contas = await dono.query(
      "select count(*)::int as n from acesso.credenciais where conta_no_provedor = 'google-789'",
    );
    expect(contas.rows[0].n).toBe(0);
  });

  it("pessoa bloqueada não entra pelo Google", async () => {
    await dono.query("update pessoas set situacao = 'bloqueada' where email = 'dona@teste.invalid'");
    const { volta } = await entrarComGoogle({
      sub: "google-123",
      email: "dona@teste.invalid",
      email_verified: true,
    });
    await dono.query("update pessoas set situacao = 'ativa' where email = 'dona@teste.invalid'");
    expect(String(volta.headers["set-cookie"] ?? "")).not.toMatch(/session_token=[^;]+/);
    expect(volta.statusCode).not.toBe(200);
  });

  it("entrar pelo Google não pula o 2FA do Mago OS", async () => {
    const cookieDa = (volta: { headers: Record<string, unknown> }) =>
      ([] as string[])
        .concat((volta.headers["set-cookie"] as string[] | string | undefined) ?? [])
        .map((c) => c.split(";")[0])
        .join("; ");
    const estado = async (cookie: string) =>
      (await app.inject({ method: "GET", url: "/acesso/estado", headers: { cookie } })).json();

    // Dono da plataforma sem 2FA: entra, mas só pode ativar.
    const primeira = await entrarComGoogle({
      sub: "google-123",
      email: "dona@teste.invalid",
      email_verified: true,
    });
    expect(await estado(cookieDa(primeira.volta))).toMatchObject({ completa: false, falta: "ativar" });

    // Com o app autenticador ativo: entra pelo Google, mas precisa confirmar o código.
    await dono.query(
      `insert into acesso.dois_fatores (pessoa_id, segredo, codigos_recuperacao, verificado)
         select id, 'x', 'x', true from pessoas where email = 'dona@teste.invalid'`,
    );
    await dono.query("update pessoas set dois_fatores_ativo = true where email = 'dona@teste.invalid'");
    const segunda = await entrarComGoogle({
      sub: "google-123",
      email: "dona@teste.invalid",
      email_verified: true,
    });
    expect(await estado(cookieDa(segunda.volta))).toMatchObject({ completa: false, falta: "confirmar" });
  });
});
