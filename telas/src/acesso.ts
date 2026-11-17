/**
 * Conversa da tela com o login da API (/api/acesso, M1-03 a M1-05).
 * O cookie da sessão é HttpOnly: a tela nunca vê o token, só pergunta à API quem está conectado.
 */

export interface Sessao {
  pessoa: { id: string; nome: string; email: string };
  empresaId: string | null;
  /** O que falta do 2FA: nada, ativar (obrigatório e ainda sem) ou confirmar (entrou, falta o código). */
  falta: "nada" | "ativar" | "confirmar";
  doisFatores: { obrigatorio: boolean; appAutenticador: boolean; passkeys: number; exigePasskey: boolean };
}

export interface Resultado {
  ok: boolean;
  mensagem?: string;
  /** Código do erro que a API devolveu, quando houver. */
  codigo?: string;
}

const BASE = "/api/acesso";

/** Textos em português para os códigos que a API devolve (o Better Auth responde em inglês). */
const MENSAGENS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 10 caracteres.",
  PASSWORD_TOO_LONG: "A senha pode ter no máximo 128 caracteres.",
  INVALID_TOKEN: "Este link expirou ou já foi usado. Peça um novo.",
  PASSWORD_COMPROMISED:
    "Essa senha já apareceu em vazamentos na internet. Escolha outra, de preferência uma frase longa.",
  INVALID_PASSWORD: "Senha incorreta.",
  INVALID_CODE: "Código incorreto. Confira o app e tente de novo.",
  INVALID_BACKUP_CODE: "Código de recuperação incorreto ou já usado.",
  INVALID_TWO_FACTOR_COOKIE: "O tempo para digitar o código acabou. Entre de novo.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Muitas tentativas. Entre de novo para ter outra chance.",
  // Erros que voltam do Google pelo endereço (?error=...).
  signup_disabled: "Essa conta Google não tem acesso ao Mago OS. Use a conta do e-mail do seu convite.",
  account_not_linked:
    "Não foi possível ligar essa conta Google. Entre com a senha ou fale com o administrador.",
  unable_to_link_account:
    "Não foi possível ligar essa conta Google. Entre com a senha ou fale com o administrador.",
  email_not_found: "O Google não informou o e-mail dessa conta.",
};

/** Códigos cuja mensagem já vem em português do próprio Mago OS. */
const MENSAGENS_DO_MAGO = [
  "ACESSO_TRAVADO",
  "ACESSO_BLOQUEADO",
  "CONFIRMACAO_NECESSARIA",
  "DOIS_FATORES_OBRIGATORIO",
];

const PADRAO = "Não foi possível concluir agora. Tente de novo em instantes.";

export function mensagemDoErro(codigo: string | null | undefined, mensagemDaApi?: string): string {
  if (codigo && MENSAGENS[codigo]) return MENSAGENS[codigo];
  if (codigo && MENSAGENS_DO_MAGO.includes(codigo)) return mensagemDaApi ?? PADRAO;
  return PADRAO;
}

async function enviar(caminho: string, corpo: unknown): Promise<Resultado & { dados?: unknown }> {
  try {
    const r = await fetch(`${BASE}${caminho}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(corpo),
    });
    const dados = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (r.ok) return { ok: true, dados };
    if (r.status === 429 && !dados?.code) {
      return { ok: false, mensagem: "Muitas tentativas. Espere um minuto e tente de novo." };
    }
    return {
      ok: false,
      mensagem: mensagemDoErro(dados?.code, dados?.message),
      ...(dados?.code ? { codigo: dados.code } : {}),
    };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o Mago OS. Confira a internet e tente de novo." };
  }
}

/** Quem está conectado e o que falta do 2FA. Nulo sem sessão. */
export async function lerSessao(): Promise<Sessao | null> {
  try {
    const r = await fetch(`${BASE}/estado`, { credentials: "same-origin" });
    if (!r.ok) return null;
    return (await r.json()) as Sessao | null;
  } catch {
    return null;
  }
}

/** Entra com e-mail e senha. Se a pessoa tem o app autenticador, volta pedindo o código (precisaDoCodigo). */
export async function entrar(
  email: string,
  senha: string,
): Promise<Resultado & { precisaDoCodigo?: boolean }> {
  const r = await enviar("/sign-in/email", { email, password: senha });
  const pede = (r.dados as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect === true;
  return pede ? { ok: true, precisaDoCodigo: true } : r;
}

/** Confere o código do app (no login, ou numa sessão já aberta). */
export function confirmarCodigo(codigo: string, confiarNoAparelho: boolean) {
  return enviar("/two-factor/verify-totp", {
    code: codigo.replace(/\s/g, ""),
    trustDevice: confiarNoAparelho,
  });
}

export function confirmarCodigoDeRecuperacao(codigo: string, confiarNoAparelho: boolean) {
  return enviar("/two-factor/verify-backup-code", { code: codigo.trim(), trustDevice: confiarNoAparelho });
}

/** Começa a ativar o app autenticador: devolve o endereço do QR code e os 10 códigos de recuperação. */
export async function comecarAppAutenticador(
  senha?: string,
): Promise<Resultado & { totpURI?: string; codigos?: string[] }> {
  const r = await enviar("/two-factor/enable", senha ? { password: senha } : {});
  const d = r.dados as { totpURI?: string; backupCodes?: string[] } | undefined;
  return r.ok && d?.totpURI ? { ok: true, totpURI: d.totpURI, codigos: d.backupCodes ?? [] } : r;
}

function mensagemDaPasskey(erro: unknown): string {
  const nome = (erro as { name?: string } | null)?.name;
  if (nome === "NotAllowedError" || nome === "AbortError")
    return "A passkey foi cancelada ou o tempo acabou.";
  if (nome === "InvalidStateError") return "Este aparelho já tem uma passkey do Mago OS.";
  return "Não foi possível usar a passkey neste aparelho.";
}

/** Cadastra uma passkey neste aparelho (Face ID, Touch ID, digital ou chave física). */
export async function cadastrarPasskey(nome: string): Promise<Resultado> {
  try {
    const { startRegistration } = await import("@simplewebauthn/browser");
    const opcoes = await fetch(`${BASE}/passkey/generate-register-options`, { credentials: "same-origin" });
    const dados = (await opcoes.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (!opcoes.ok) return { ok: false, mensagem: mensagemDoErro(dados?.code, dados?.message) };
    const resposta = await startRegistration({ optionsJSON: dados as never });
    return await enviar("/passkey/verify-registration", { response: resposta, name: nome });
  } catch (erro) {
    return { ok: false, mensagem: mensagemDaPasskey(erro) };
  }
}

/** Entra (ou confirma a sessão) com a passkey. */
export async function entrarComPasskey(): Promise<Resultado> {
  try {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const opcoes = await fetch(`${BASE}/passkey/generate-authenticate-options`, {
      credentials: "same-origin",
    });
    if (!opcoes.ok) return { ok: false, mensagem: PADRAO };
    const resposta = await startAuthentication({ optionsJSON: (await opcoes.json()) as never });
    return await enviar("/passkey/verify-authentication", { response: resposta });
  } catch (erro) {
    return { ok: false, mensagem: mensagemDaPasskey(erro) };
  }
}

export function sair() {
  return enviar("/sign-out", {});
}

export function pedirLinkDeSenha(email: string) {
  return enviar("/request-password-reset", { email });
}

export function definirSenha(token: string, senha: string) {
  return enviar("/reset-password", { token, newPassword: senha });
}

/** Pede à API o endereço do Google e vai para lá. Na volta, o Google traz a pessoa para a tela inicial. */
export async function entrarComGoogle(): Promise<Resultado> {
  const r = await enviar("/sign-in/social", {
    provider: "google",
    callbackURL: `${window.location.origin}/`,
    errorCallbackURL: `${window.location.origin}/entrar`,
  });
  const url = (r.dados as { url?: string } | undefined)?.url;
  if (r.ok && url) {
    window.location.assign(url);
    return { ok: true };
  }
  return r.ok ? { ok: false, mensagem: "O login com Google ainda não está ligado." } : r;
}
