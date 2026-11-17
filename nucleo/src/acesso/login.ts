/**
 * Login por e-mail e senha (M1-03), com o Better Auth ligado às tabelas do Mago OS.
 *
 * - A pessoa é a mesma tabela "pessoas" da M1-02; senhas, sessões e links ficam no esquema "acesso".
 * - O Better Auth usa o papel mago_acesso, que não enxerga empresas nem vínculos (migração 0003).
 * - Não existe cadastro aberto: a pessoa entra por convite (M1-07) ou pelo comando de início.
 * - Ver docs/decisoes/0009-login-com-better-auth.md.
 */
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import pg from "pg";
import { aparelhoConfiavel, CAMINHOS_QUE_CONFIRMAM, DIAS_APARELHO_CONFIAVEL } from "./dois-fatores.ts";

export const SENHA_MINIMA = 10;
export const SENHA_MAXIMA = 128;
/** A sessão vale 7 dias e se renova uma vez por dia enquanto a pessoa usa. */
export const SESSAO_SEGUNDOS = 7 * 24 * 60 * 60;
export const RENOVAR_SESSAO_SEGUNDOS = 24 * 60 * 60;
/** O link de recuperação de senha vale 1 hora e só pode ser usado uma vez. */
export const LINK_SENHA_SEGUNDOS = 60 * 60;

/** Quem entrega os e-mails do sistema. O Resend entra numa tarefa própria; até lá, o link vai para o log. */
export interface Carteiro {
  enviarLinkDeSenha(dados: { para: string; nome: string; link: string }): Promise<void>;
}

export interface OpcoesDoLogin {
  /** Conexão com o papel mago_acesso. */
  bancoUrl: string;
  /** Segredo que assina os cookies (pelo menos 32 caracteres, vem do Infisical). */
  segredo: string;
  /** Endereço público do site (ex.: https://teste.osmago.com). A API fica em /api. */
  urlPublica: string;
  ambiente: "local" | "teste" | "producao";
  /** Recusar senhas que já vazaram (Have I Been Pwned). Só os testes automáticos desligam. */
  conferirSenhasVazadas: boolean;
  carteiro: Carteiro;
  /** Login com Google (M1-04). Sem ele, só e-mail e senha. */
  google?: { id: string; segredo: string } | null;
}

export function criarPoolDoLogin(bancoUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: bancoUrl,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    application_name: "mago-os-acesso",
    // As tabelas do login ficam no esquema acesso; as pessoas, no public.
    options: "-c search_path=acesso,public",
  });
  pool.on("error", () => {});
  return pool;
}

export function criarLogin(opcoes: OpcoesDoLogin, pool: pg.Pool) {
  const site = new URL(opcoes.urlPublica);
  return betterAuth({
    appName: "Mago OS",
    baseURL: site.origin,
    basePath: "/api/acesso",
    secret: opcoes.segredo,
    database: pool,
    trustedOrigins: [site.origin],
    telemetry: { enabled: false },
    // Erros no retorno do Google voltam para a tela de entrar, com ?error=<código>.
    onAPIError: { errorURL: `${site.origin}/entrar` },
    ...(opcoes.google
      ? {
          socialProviders: {
            google: {
              clientId: opcoes.google.id,
              clientSecret: opcoes.google.segredo,
              // Só entra quem já existe no sistema: o Google nunca cria pessoa nova.
              disableSignUp: true,
              // Pede ao Google só nome, e-mail e foto (openid, email e profile, o padrão).
              prompt: "select_account" as const,
              // Mantém o nome que a pessoa tem no Mago OS, mesmo se o do Google for outro.
              overrideUserInfoOnSignIn: false,
            },
          },
        }
      : {}),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: SENHA_MINIMA,
      maxPasswordLength: SENHA_MAXIMA,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      // Quem usou o link mandado ao e-mail provou que o e-mail é dele.
      async onPasswordReset({ user }) {
        await pool.query("update pessoas set email_verificado = true, atualizada_em = now() where id = $1", [
          user.id,
        ]);
      },
      resetPasswordTokenExpiresIn: LINK_SENHA_SEGUNDOS,
      async sendResetPassword({ user, token }) {
        const link = `${site.origin}/redefinir-senha?token=${encodeURIComponent(token)}`;
        await opcoes.carteiro.enviarLinkDeSenha({ para: user.email, nome: user.name, link });
      },
    },
    user: {
      modelName: "pessoas",
      fields: {
        name: "nome",
        emailVerified: "email_verificado",
        image: "foto",
        createdAt: "criada_em",
        updatedAt: "atualizada_em",
      },
    },
    session: {
      modelName: "sessoes",
      expiresIn: SESSAO_SEGUNDOS,
      updateAge: RENOVAR_SESSAO_SEGUNDOS,
      fields: {
        userId: "pessoa_id",
        expiresAt: "expira_em",
        ipAddress: "ip",
        userAgent: "navegador",
        createdAt: "criada_em",
        updatedAt: "atualizada_em",
      },
      additionalFields: {
        empresaId: { type: "string", fieldName: "empresa_id", required: false, input: false },
        // Quando a sessão passou pelo segundo fator (M1-05).
        doisFatoresEm: { type: "date", fieldName: "dois_fatores_em", required: false, input: false },
      },
    },
    account: {
      modelName: "credenciais",
      // A conta Google só se liga à pessoa com o mesmo e-mail, confirmado pelo Google e pelo Mago OS.
      accountLinking: { enabled: true, allowDifferentEmails: false, updateUserInfoOnLink: false },
      fields: {
        accountId: "conta_no_provedor",
        providerId: "provedor",
        userId: "pessoa_id",
        accessToken: "token_acesso",
        refreshToken: "token_renovacao",
        idToken: "token_id",
        accessTokenExpiresAt: "token_acesso_expira_em",
        refreshTokenExpiresAt: "token_renovacao_expira_em",
        scope: "escopo",
        password: "senha",
        createdAt: "criada_em",
        updatedAt: "atualizada_em",
      },
    },
    verification: {
      modelName: "verificacoes",
      // Guarda só a impressão digital do código do link: quem lê o banco não consegue usar o link.
      storeIdentifier: "hashed",
      fields: {
        identifier: "identificador",
        value: "valor",
        expiresAt: "expira_em",
        createdAt: "criada_em",
        updatedAt: "atualizada_em",
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "limites",
      fields: { key: "chave", count: "pedidos", lastRequest: "ultimo_pedido" },
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/social": { window: 60, max: 10 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: "mago",
      useSecureCookies: opcoes.ambiente !== "local",
      database: { generateId: false },
      // O Caddy da VPS02 grava o IP de quem pediu neste cabeçalho, apagando o que vier de fora.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      session: {
        create: {
          async before(sessao, contexto) {
            const r = await pool.query<{ situacao: string; empresa: string | null; app: boolean }>(
              "select situacao, acesso.empresa_inicial(id) as empresa, dois_fatores_ativo as app from pessoas where id = $1",
              [sessao.userId],
            );
            if (r.rows[0]?.situacao !== "ativa") {
              throw APIError.from("FORBIDDEN", {
                message: "Seu acesso está bloqueado. Fale com o administrador da sua empresa.",
                code: "ACESSO_BLOQUEADO",
              });
            }
            // A sessão já nasce confirmada quando acabou de passar pelo segundo fator: código, código de recuperação,
            // passkey, ou aparelho confiável (no login por senha, o plugin só deixa a sessão existir se o aparelho
            // for confiável; no login com Google, conferimos o cookie aqui). Sessões recriadas mantêm a marca.
            const caminho = contexto?.path ?? "";
            let confirmada = (sessao as { doisFatoresEm?: Date | null }).doisFatoresEm != null;
            if (CAMINHOS_QUE_CONFIRMAM.has(caminho)) confirmada = true;
            else if (caminho === "/sign-in/email" && r.rows[0]?.app) confirmada = true;
            else if (caminho.startsWith("/callback/") && contexto) {
              const cookie = contexto.context.createAuthCookie("trust_device");
              const assinado = await contexto.getSignedCookie(cookie.name, contexto.context.secret);
              const valor = typeof assinado === "string" ? assinado : null;
              confirmada = await aparelhoConfiavel(
                valor,
                sessao.userId,
                contexto.context.secret,
                async (id) => {
                  const v = await contexto.context.internalAdapter.findVerificationValue(id);
                  return v ? { value: v.value, expiresAt: v.expiresAt } : null;
                },
              );
            }
            return {
              data: {
                ...sessao,
                empresaId: r.rows[0]?.empresa ?? null,
                doisFatoresEm: confirmada ? new Date() : null,
              },
            };
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "Mago OS",
        trustDeviceMaxAge: DIAS_APARELHO_CONFIAVEL * 24 * 60 * 60,
        // Quem entra só com o Google não tem senha: a sessão aberta basta para ativar, e as ações perigosas pedem
        // o segundo fator recente (regra do Mago OS, em rotas.ts).
        allowPasswordless: true,
        backupCodeOptions: { amount: 10, length: 10 },
        schema: {
          user: { fields: { twoFactorEnabled: "dois_fatores_ativo" } },
          twoFactor: {
            modelName: "dois_fatores",
            fields: {
              secret: "segredo",
              backupCodes: "codigos_recuperacao",
              userId: "pessoa_id",
              verified: "verificado",
              failedVerificationCount: "falhas",
              lockedUntil: "travado_ate",
            },
          },
        },
      }),
      passkey({
        rpID: site.hostname,
        rpName: "Mago OS",
        origin: site.origin,
        schema: {
          passkey: {
            modelName: "passkeys",
            fields: {
              name: "nome",
              publicKey: "chave_publica",
              userId: "pessoa_id",
              credentialID: "credencial_id",
              counter: "contador",
              deviceType: "tipo_aparelho",
              backedUp: "copia_na_nuvem",
              transports: "transportes",
              createdAt: "criada_em",
            },
          },
        },
      }),
      haveIBeenPwned({
        enabled: opcoes.conferirSenhasVazadas,
        customPasswordCompromisedMessage:
          "Essa senha já apareceu em vazamentos na internet. Escolha outra, de preferência uma frase longa.",
      }),
    ],
  });
}

export type Login = ReturnType<typeof criarLogin>;

/** Embaralha uma senha do mesmo jeito que o login (scrypt). Só para dados de teste: nunca em produção. */
export { hashPassword as embaralharSenha } from "better-auth/crypto";
