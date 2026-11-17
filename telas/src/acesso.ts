/**
 * Conversa da tela com o login da API (/api/acesso, M1-03 a M1-05).
 * O cookie da sessão é HttpOnly: a tela nunca vê o token, só pergunta à API quem está conectado.
 */

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

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

export type TipoDePasskey = "cadastro" | "entrada";

/**
 * Opções da passkey buscadas antes do clique. Alguns navegadores (Safari, e o Chrome em certos casos) só abrem
 * a janela da passkey se ela for pedida logo depois do clique, sem esperar a rede no meio.
 */
export async function prepararPasskey(tipo: TipoDePasskey): Promise<unknown | Resultado> {
  const caminho = tipo === "cadastro" ? "generate-register-options" : "generate-authenticate-options";
  try {
    const r = await fetch(`${BASE}/passkey/${caminho}`, { credentials: "same-origin" });
    const dados = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (!r.ok)
      return { ok: false, mensagem: mensagemDoErro(dados?.code, dados?.message) } satisfies Resultado;
    return dados;
  } catch {
    return {
      ok: false,
      mensagem: "Sem conexão com o Mago OS. Confira a internet e tente de novo.",
    } satisfies Resultado;
  }
}

/** Cadastra uma passkey neste aparelho (Face ID, Touch ID, digital, chave física ou celular por QR code). */
export async function cadastrarPasskey(opcoes: unknown, nome: string): Promise<Resultado> {
  try {
    const resposta = await startRegistration({ optionsJSON: opcoes as never });
    return await enviar("/passkey/verify-registration", { response: resposta, name: nome });
  } catch (erro) {
    return { ok: false, mensagem: mensagemDaPasskey(erro) };
  }
}

/** Entra (ou confirma a sessão) com a passkey. */
export async function entrarComPasskey(opcoes: unknown): Promise<Resultado> {
  try {
    const resposta = await startAuthentication({ optionsJSON: opcoes as never });
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

/**
 * Para onde voltar depois de entrar (?volta=/convite?codigo=...). Só caminhos do próprio site: um endereço de fora
 * (//outro.site ou https://...) é ignorado, e a pessoa vai para a tela inicial.
 */
export function destinoDepoisDeEntrar(): string {
  const volta = new URLSearchParams(window.location.search).get("volta") ?? "";
  return /^\/(?![/\\])/.test(volta) ? volta : "/";
}

/** Pede à API o endereço do Google e vai para lá. Na volta, o Google traz a pessoa para a tela pedida. */
export async function entrarComGoogle(volta = destinoDepoisDeEntrar()): Promise<Resultado> {
  const r = await enviar("/sign-in/social", {
    provider: "google",
    callbackURL: `${window.location.origin}${volta}`,
    errorCallbackURL: `${window.location.origin}/entrar`,
  });
  const url = (r.dados as { url?: string } | undefined)?.url;
  if (r.ok && url) {
    window.location.assign(url);
    return { ok: true };
  }
  return r.ok ? { ok: false, mensagem: "O login com Google ainda não está ligado." } : r;
}

export interface AparelhoConectado {
  sessaoId: string;
  aparelho: string;
  ip: string | null;
  entrouEm: string;
  ultimoUsoEm: string;
  esteAparelho: boolean;
}

export interface AvisoDeAcesso {
  avisoId: string;
  aparelho: string;
  ip: string | null;
  em: string;
}

async function ler<T>(caminho: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${caminho}`, { credentials: "same-origin" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const listarAparelhos = () => ler<AparelhoConectado[]>("/aparelhos");
export const listarAvisos = () => ler<AvisoDeAcesso[]>("/avisos");

export function desconectarAparelho(sessaoId: string) {
  return enviar("/aparelhos/desconectar", { sessaoId });
}

export function desconectarOutros() {
  return enviar("/aparelhos/desconectar-outros", {});
}

export async function responderAviso(avisoId: string, resposta: "foi_eu" | "nao_fui_eu"): Promise<Resultado> {
  const r = await enviar("/avisos/responder", { avisoId, resposta });
  const mensagem = (r.dados as { mensagem?: string } | undefined)?.mensagem;
  return mensagem ? { ...r, mensagem } : r;
}

// Conta da própria pessoa (M1-10).

export interface EmpresaMinha {
  id: string;
  nome: string;
  perfil: "administrador" | "gestor_area" | "funcionario";
  area: string | null;
  ativa: boolean;
}

export interface Perfil {
  nome: string;
  email: string;
  foto: string | null;
  idioma: string;
  fusoHorario: string;
  temSenha: boolean;
  googleLigado: boolean;
  doisFatores: { obrigatorio: boolean; appAutenticador: boolean; passkeys: number; exigePasskey: boolean };
  donoDaPlataforma: boolean;
}

export interface PasskeyCadastrada {
  id: string;
  name?: string | null;
  createdAt: string;
  deviceType?: string;
}

async function lerConta<T>(caminho: string): Promise<T | null> {
  try {
    const r = await fetch(`/api${caminho}`, { credentials: "same-origin" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function enviarConta(metodo: "POST" | "PUT", caminho: string, corpo: unknown): Promise<Resultado> {
  try {
    const r = await fetch(`/api${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(corpo),
    });
    if (r.ok) return { ok: true };
    const dados = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
    return {
      ok: false,
      mensagem: dados?.message ?? mensagemDoErro(dados?.code),
      ...(dados?.code ? { codigo: dados.code } : {}),
    };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o Mago OS. Confira a internet e tente de novo." };
  }
}

export const listarEmpresas = () => lerConta<EmpresaMinha[]>("/conta/empresas");
export const trocarEmpresa = (empresaId: string) =>
  enviarConta("POST", "/conta/empresa-ativa", { empresaId });
export const lerPerfil = () => lerConta<Perfil>("/conta/perfil");
export const salvarPerfil = (dados: { nome: string; idioma: string; fusoHorario: string }) =>
  enviarConta("PUT", "/conta/perfil", dados);

export function trocarSenha(atual: string, nova: string) {
  return enviar("/change-password", { currentPassword: atual, newPassword: nova, revokeOtherSessions: true });
}

export const listarPasskeys = () => ler<PasskeyCadastrada[]>("/passkey/list-user-passkeys");
export const apagarPasskey = (id: string) => enviar("/passkey/delete-passkey", { id });

export async function gerarCodigosNovos(senha?: string): Promise<Resultado & { codigos?: string[] }> {
  const r = await enviar("/two-factor/generate-backup-codes", senha ? { password: senha } : {});
  const codigos = (r.dados as { backupCodes?: string[] } | undefined)?.backupCodes;
  return r.ok && codigos ? { ok: true, codigos } : r;
}

// Administração da empresa (M1-10, parte 2).

export type Alcance = "nada" | "meus" | "equipe" | "tudo";
export type AcaoNoModulo = "ver" | "criar" | "editar" | "aprovar" | "excluir";

export interface PermissaoNoModulo {
  acoes: Record<AcaoNoModulo, Alcance>;
  verSensiveis: boolean;
}

export interface MinhasPermissoes {
  perfil: string;
  area: string | null;
  modulos: Record<string, PermissaoNoModulo>;
}

export interface PessoaDaEmpresa {
  vinculoId: string;
  id: string;
  nome: string;
  email: string | null;
  perfil: "administrador" | "gestor_area" | "funcionario";
  area: string | null;
  situacao: "convidado" | "ativo" | "desligado";
}

export interface ModuloComPermissao {
  id: string;
  nome: string;
  acoes: AcaoNoModulo[];
  temDadosSensiveis: boolean;
  permissao: PermissaoNoModulo;
  ajustes: Partial<Record<AcaoNoModulo | "ver_sensiveis", Alcance>>;
}

export interface EventoDaAuditoria {
  sequencia: number;
  ator: { tipo: string; pessoaId?: string; agenteId?: string; servico?: string };
  acao: string;
  alvo: { tipo: string; id: string } | null;
  origem: { canal: string; ip: string | null; aparelho: string | null };
  ocorrido_em: string;
  detalhes: Record<string, unknown>;
}

export const minhasPermissoes = () => lerConta<MinhasPermissoes>("/empresa/minhas-permissoes");
export const listarPessoas = () => lerConta<PessoaDaEmpresa[]>("/empresa/pessoas");
export const permissoesDaPessoa = (vinculoId: string) =>
  lerConta<{ pessoa: { nome: string; perfil: string; area: string | null }; modulos: ModuloComPermissao[] }>(
    `/empresa/pessoas/${vinculoId}/permissoes`,
  );
export const ajustarPermissao = (dados: {
  vinculoId: string;
  modulo: string;
  acao: AcaoNoModulo | "ver_sensiveis";
  alcance: Alcance;
}) => enviarConta("PUT", "/empresa/permissoes", dados);
export const lerSeguranca = () =>
  lerConta<{ exigirDoisFatores: boolean; exigirPasskey: boolean }>("/empresa/seguranca");
export const salvarSeguranca = (dados: { exigirDoisFatores: boolean; exigirPasskey: boolean }) =>
  enviarConta("PUT", "/empresa/seguranca", dados);
export const lerRegrasDaPlataforma = () =>
  lerConta<{ exigirPasskeyAdministradores: boolean }>("/plataforma/regras");
export const salvarRegrasDaPlataforma = (exigirPasskeyAdministradores: boolean) =>
  enviarConta("PUT", "/plataforma/regras", { exigirPasskeyAdministradores });

export function listarAuditoria(filtros: { acao?: string; desde?: string; ate?: string }) {
  const q = new URLSearchParams({ limite: "200" });
  for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
  return lerConta<EventoDaAuditoria[]>(`/empresa/auditoria?${q}`);
}

// Convites e desligamento (M1-07).

export const convidar = (dados: { email: string; nome: string; perfil: string; area: string | null }) =>
  enviarConta("POST", "/empresa/convites", dados);
export const reenviarConvite = (vinculoId: string) =>
  enviarConta("POST", `/empresa/convites/${vinculoId}/reenviar`, {});
export const cancelarConvite = (vinculoId: string) =>
  enviarConta("POST", `/empresa/convites/${vinculoId}/cancelar`, {});
export const desligarPessoa = (vinculoId: string) =>
  enviarConta("POST", `/empresa/pessoas/${vinculoId}/desligar`, {});

export interface ConviteAberto {
  empresa: string;
  email: string;
  nome: string;
  quemConvidou: string;
  temConta: boolean;
}

export const abrirConvite = (codigo: string) =>
  lerConta<ConviteAberto>(`/acesso/convite/${encodeURIComponent(codigo)}`);
export const aceitarConvite = (codigo: string, senha?: string) =>
  enviarConta("POST", "/acesso/convite/aceitar", senha ? { codigo, senha } : { codigo });

// Convite para criar empresa (M1-11).

export interface ContaDaPlataforma {
  id: string;
  nome: string;
  tipo: "pj" | "pf" | null;
  documento: string | null;
  situacao: string;
  criadaEm: string;
  pessoas: number;
}

export interface ConviteDeConta {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
  expiraEm: string;
}

export const listarContasDaPlataforma = () =>
  lerConta<{ empresas: ContaDaPlataforma[]; convites: ConviteDeConta[] }>("/plataforma/empresas");
export const convidarConta = (dados: { nome: string; email: string }) =>
  enviarConta("POST", "/plataforma/empresas/convites", dados);
export const reenviarConviteDeConta = (id: string) =>
  enviarConta("POST", `/plataforma/empresas/convites/${id}/reenviar`, {});
export const cancelarConviteDeConta = (id: string) =>
  enviarConta("POST", `/plataforma/empresas/convites/${id}/cancelar`, {});

export interface ConviteDeContaAberto {
  nome: string;
  email: string;
  quemConvidou: string;
  temConta: boolean;
}

export interface DadosDaNovaConta {
  tipo: "pj" | "pf";
  documento: string;
  nomeLegal: string;
  nome: string;
  fusoHorario: string;
  idioma: string;
  telefone: string;
}

export const abrirConviteDeConta = (codigo: string) =>
  lerConta<ConviteDeContaAberto>(`/acesso/convite-de-empresa/${encodeURIComponent(codigo)}`);
export const criarContaPeloConvite = (codigo: string, conta: DadosDaNovaConta, senha?: string) =>
  enviarConta(
    "POST",
    "/acesso/convite-de-empresa/criar",
    senha ? { codigo, senha, conta } : { codigo, conta },
  );
