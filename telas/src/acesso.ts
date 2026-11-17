/**
 * Conversa da tela com o login da API (/api/acesso, M1-03 e M1-04).
 * O cookie da sessão é HttpOnly: a tela nunca vê o token, só pergunta à API quem está conectado.
 */

export interface Sessao {
  pessoa: { id: string; nome: string; email: string };
  empresaId: string | null;
}

export interface Resultado {
  ok: boolean;
  mensagem?: string;
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
  // Erros que voltam do Google pelo endereço (?error=...).
  signup_disabled: "Essa conta Google não tem acesso ao Mago OS. Use a conta do e-mail do seu convite.",
  account_not_linked:
    "Não foi possível ligar essa conta Google. Entre com a senha ou fale com o administrador.",
  unable_to_link_account:
    "Não foi possível ligar essa conta Google. Entre com a senha ou fale com o administrador.",
  email_not_found: "O Google não informou o e-mail dessa conta.",
};

const PADRAO = "Não foi possível concluir agora. Tente de novo em instantes.";

export function mensagemDoErro(codigo: string | null | undefined, mensagemDaApi?: string): string {
  if (codigo && MENSAGENS[codigo]) return MENSAGENS[codigo];
  // A trava e o bloqueio já vêm com o texto em português do próprio Mago OS.
  if (codigo === "ACESSO_TRAVADO" || codigo === "ACESSO_BLOQUEADO") return mensagemDaApi ?? PADRAO;
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
    return { ok: false, mensagem: mensagemDoErro(dados?.code, dados?.message) };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o Mago OS. Confira a internet e tente de novo." };
  }
}

export async function lerSessao(): Promise<Sessao | null> {
  try {
    const r = await fetch(`${BASE}/get-session`, { credentials: "same-origin" });
    if (!r.ok) return null;
    const dados = (await r.json()) as {
      user?: { id: string; name: string; email: string };
      session?: { empresaId?: string | null };
    } | null;
    if (!dados?.user) return null;
    return {
      pessoa: { id: dados.user.id, nome: dados.user.name, email: dados.user.email },
      empresaId: dados.session?.empresaId ?? null,
    };
  } catch {
    return null;
  }
}

export function entrar(email: string, senha: string) {
  return enviar("/sign-in/email", { email, password: senha });
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
