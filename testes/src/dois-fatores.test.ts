/**
 * Autenticação em 2 fatores (M1-05), de ponta a ponta: API (Fastify + Better Auth) e banco de verdade.
 * O código do app autenticador é calculado aqui mesmo, a partir do QR code, como o app do celular faz.
 */
import { createHmac } from "node:crypto";
import {
  type Carteiro,
  criarLogin,
  criarPoolDoLogin,
  desligarDoisFatores,
  exigirSessaoCompleta,
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

/** Código de 6 dígitos do app autenticador (TOTP, RFC 6238), a partir do segredo do QR code. */
function codigoDoApp(totpURI: string, deslocamento = 0): string {
  const segredo = new URL(totpURI).searchParams.get("secret") ?? "";
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letra of segredo.replace(/=+$/, "").toUpperCase())
    bits += alfabeto.indexOf(letra).toString(2).padStart(5, "0");
  const chave = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + deslocamento));
  const hmac = createHmac("sha1", chave).update(passo).digest();
  const inicio = (hmac[hmac.length - 1] ?? 0) & 0xf;
  return String((hmac.readUInt32BE(inicio) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe.skipIf(!bancoDisponivel)("autenticação em 2 fatores", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let ipDaVez = 0;
  let totpURI = "";
  let codigosDeRecuperacao: string[] = [];
  const links: string[] = [];
  const carteiro: Carteiro = {
    async enviarLinkDeSenha({ link }) {
      links.push(link);
    },
  };

  const cookiesDe = (r: { headers: Record<string, unknown> }) =>
    ([] as string[])
      .concat((r.headers["set-cookie"] as string[] | string | undefined) ?? [])
      .map((c) => c.split(";")[0] ?? "")
      .filter((c) => !/=$/.test(c));

  function juntar(...listas: (string | string[] | undefined)[]) {
    const mapa = new Map<string, string>();
    for (const c of listas.flat().filter(Boolean) as string[])
      for (const parte of c.split("; ")) mapa.set(parte.split("=")[0] ?? "", parte);
    return [...mapa.values()].join("; ");
  }

  function pedir(metodo: "GET" | "POST", caminho: string, corpo?: unknown, cookie?: string) {
    ipDaVez += 1;
    return app.inject({
      method: metodo,
      url: caminho,
      headers: {
        origin: SITE,
        "x-forwarded-for": `192.0.2.${ipDaVez % 250}`,
        ...(cookie ? { cookie } : {}),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  }

  async function entrarComSenha(email: string, cookieExtra?: string) {
    const r = await pedir("POST", "/acesso/sign-in/email", { email, password: SENHA }, cookieExtra);
    return { r, cookie: juntar(cookieExtra, cookiesDe(r)) };
  }

  async function estado(cookie: string) {
    return (await pedir("GET", "/acesso/estado", undefined, cookie)).json();
  }

  async function definirSenha(email: string) {
    links.length = 0;
    await pedir("POST", "/acesso/request-password-reset", { email });
    const token = new URL(links[0] ?? "").searchParams.get("token");
    await pedir("POST", "/acesso/reset-password", { newPassword: SENHA, token });
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const { empresaId } = await iniciarPlataforma(dono, {
      nome: "Pessoa Dona",
      email: "dona@teste.invalid",
      empresa: "Empresa Um",
    });
    const func = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Funcionária', 'func@teste.invalid', true) returning id",
    );
    await dono.query(
      "insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) values ($1, $2, 'funcionario', 'ativo', now(), now())",
      [empresaId, func.rows[0]?.id],
    );
    pool = criarPoolDoLogin(banco.urlAcesso);
    const login = criarLogin(
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
    // Uma rota de dados qualquer, protegida como serão as do M1-06 em diante.
    app.get("/dados", { preHandler: exigirSessaoCompleta(login, pool) }, async () => ({ ok: true }));
    await app.ready();
    await definirSenha("dona@teste.invalid");
    await definirSenha("func@teste.invalid");
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("funcionária sem 2FA obrigatório vê os dados direto", async () => {
    const { cookie } = await entrarComSenha("func@teste.invalid");
    expect((await estado(cookie)).completa).toBe(true);
    expect((await pedir("GET", "/dados", undefined, cookie)).statusCode).toBe(200);
  });

  it("o Dono da plataforma entra, mas não vê dados até ativar o 2FA", async () => {
    const { cookie } = await entrarComSenha("dona@teste.invalid");
    const e = await estado(cookie);
    expect(e).toMatchObject({
      completa: false,
      falta: "ativar",
      doisFatores: { obrigatorio: true, passkeys: 0 },
    });
    const dados = await pedir("GET", "/dados", undefined, cookie);
    expect(dados.statusCode).toBe(403);
    expect(dados.json().code).toBe("DOIS_FATORES_ATIVAR");
  });

  it("ativa o app autenticador: QR code, 10 códigos de recuperação, e só vale depois de confirmar", async () => {
    const { cookie } = await entrarComSenha("dona@teste.invalid");
    const ativar = await pedir("POST", "/acesso/two-factor/enable", { password: SENHA }, cookie);
    expect(ativar.statusCode).toBe(200);
    ({ totpURI, backupCodes: codigosDeRecuperacao } = ativar.json());
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/Mago%20OS:dona%40teste\.invalid\?/);
    expect(codigosDeRecuperacao).toHaveLength(10);
    const novoCookie = juntar(cookie, cookiesDe(ativar));
    expect((await estado(novoCookie)).falta).toBe("ativar");

    const confirmar = await pedir(
      "POST",
      "/acesso/two-factor/verify-totp",
      { code: codigoDoApp(totpURI) },
      novoCookie,
    );
    expect(confirmar.statusCode).toBe(200);
    const e = await estado(juntar(novoCookie, cookiesDe(confirmar)));
    expect(e).toMatchObject({ completa: true, falta: "nada", doisFatores: { appAutenticador: true } });

    const guardado = await dono.query("select segredo, codigos_recuperacao from acesso.dois_fatores");
    const segredo = new URL(totpURI).searchParams.get("secret") ?? "";
    expect(guardado.rows[0].segredo).not.toContain(segredo);
    expect(guardado.rows[0].codigos_recuperacao).not.toContain(codigosDeRecuperacao[0]);
  });

  it("no login seguinte pede o código; com o código certo e 'confiar no aparelho', entra", async () => {
    const { r, cookie } = await entrarComSenha("dona@teste.invalid");
    expect(r.json()).toMatchObject({ twoFactorRedirect: true });
    expect(cookie).not.toMatch(/session_token=/);

    const errado = await pedir("POST", "/acesso/two-factor/verify-totp", { code: "000000" }, cookie);
    expect(errado.statusCode).toBe(401);

    const certo = await pedir(
      "POST",
      "/acesso/two-factor/verify-totp",
      { code: codigoDoApp(totpURI, 1), trustDevice: true },
      cookie,
    );
    expect(certo.statusCode).toBe(200);
    const comSessao = juntar(cookie, cookiesDe(certo));
    expect(comSessao).toMatch(/trust_device=/);
    expect((await estado(comSessao)).completa).toBe(true);
    expect((await pedir("GET", "/dados", undefined, comSessao)).statusCode).toBe(200);

    // No mesmo aparelho, o próximo login não pede o código.
    const confiavel = comSessao
      .split("; ")
      .filter((c) => c.includes("trust_device"))
      .join("; ");
    const deNovo = await entrarComSenha("dona@teste.invalid", confiavel);
    expect(deNovo.r.json().twoFactorRedirect).toBeUndefined();
    expect((await estado(deNovo.cookie)).completa).toBe(true);
  });

  it("um código de recuperação entra uma vez só", async () => {
    const codigo = codigosDeRecuperacao[0];
    const primeira = await entrarComSenha("dona@teste.invalid");
    const usa = await pedir(
      "POST",
      "/acesso/two-factor/verify-backup-code",
      { code: codigo },
      primeira.cookie,
    );
    expect(usa.statusCode).toBe(200);
    expect((await estado(juntar(primeira.cookie, cookiesDe(usa)))).completa).toBe(true);

    const segunda = await entrarComSenha("dona@teste.invalid");
    const repete = await pedir(
      "POST",
      "/acesso/two-factor/verify-backup-code",
      { code: codigo },
      segunda.cookie,
    );
    expect(repete.statusCode).toBe(401);
  });

  it("para o Dono, o 2FA não pode ser desligado", async () => {
    const entrada = await entrarComSenha("dona@teste.invalid");
    const r = await pedir(
      "POST",
      "/acesso/two-factor/verify-totp",
      { code: codigoDoApp(totpURI, -1) },
      entrada.cookie,
    );
    const cookie = juntar(entrada.cookie, cookiesDe(r));
    const desligar = await pedir("POST", "/acesso/two-factor/disable", { password: SENHA }, cookie);
    expect(desligar.statusCode).toBe(403);
    expect(desligar.json().code).toBe("DOIS_FATORES_OBRIGATORIO");
  });

  it("ação perigosa pede o segundo fator de novo depois de 10 minutos", async () => {
    const entrada = await entrarComSenha("dona@teste.invalid");
    const usa = await pedir(
      "POST",
      "/acesso/two-factor/verify-backup-code",
      { code: codigosDeRecuperacao[1] },
      entrada.cookie,
    );
    const cookie = juntar(entrada.cookie, cookiesDe(usa));
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now() - interval '11 minutes' where pessoa_id = (select id from pessoas where email = 'dona@teste.invalid')",
    );
    const antes = await pedir(
      "POST",
      "/acesso/two-factor/generate-backup-codes",
      { password: SENHA },
      cookie,
    );
    expect(antes.statusCode).toBe(403);
    expect(antes.json().code).toBe("CONFIRMACAO_NECESSARIA");

    const confirma = await pedir(
      "POST",
      "/acesso/two-factor/verify-backup-code",
      { code: codigosDeRecuperacao[2] },
      cookie,
    );
    expect(confirma.statusCode).toBe(200);
    const depois = await pedir(
      "POST",
      "/acesso/two-factor/generate-backup-codes",
      { password: SENHA },
      juntar(cookie, cookiesDe(confirma)),
    );
    expect(depois.statusCode).toBe(200);
    codigosDeRecuperacao = depois.json().backupCodes;
  });

  it("passkey: com o 2FA ativo, cadastrar uma nova é ação perigosa; entrar com passkey começa sem sessão", async () => {
    const entrada = await entrarComSenha("dona@teste.invalid");
    const usa = await pedir(
      "POST",
      "/acesso/two-factor/verify-backup-code",
      { code: codigosDeRecuperacao[0] },
      entrada.cookie,
    );
    const cookie = juntar(entrada.cookie, cookiesDe(usa));
    const opcoes = await pedir("GET", "/acesso/passkey/generate-register-options", undefined, cookie);
    expect(opcoes.statusCode).toBe(200);
    expect(opcoes.json().rp).toEqual({ name: "Mago OS", id: "teste.osmago.invalid" });

    const autenticar = await pedir("GET", "/acesso/passkey/generate-authenticate-options");
    expect(autenticar.statusCode).toBe(200);
    expect(autenticar.json().rpId).toBe("teste.osmago.invalid");
  });

  it("empresa que exige de todos: a funcionária passa a precisar ativar", async () => {
    await dono.query("update empresas set exigir_dois_fatores = true");
    const { cookie } = await entrarComSenha("func@teste.invalid");
    expect((await estado(cookie)).falta).toBe("ativar");
    await dono.query("update empresas set exigir_dois_fatores = false");
  });

  it("perdeu o celular e os códigos: o comando desliga tudo, e o Dono volta a precisar ativar", async () => {
    await desligarDoisFatores(pool, "Dona@Teste.invalid");
    const contas = await dono.query(
      "select (select count(*)::int from acesso.dois_fatores) as app, (select count(*)::int from acesso.sessoes s join pessoas p on p.id = s.pessoa_id where p.email = 'dona@teste.invalid') as sessoes",
    );
    expect(contas.rows[0]).toEqual({ app: 0, sessoes: 0 });
    const { r, cookie } = await entrarComSenha("dona@teste.invalid");
    expect(r.json().twoFactorRedirect).toBeUndefined();
    expect((await estado(cookie)).falta).toBe("ativar");
  });
});
