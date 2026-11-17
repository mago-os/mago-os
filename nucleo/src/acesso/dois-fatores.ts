/**
 * Autenticação em 2 fatores (M1-05): quem precisa, o estado de cada sessão e as regras das ações perigosas.
 * O Better Auth cuida do app autenticador, dos códigos e da passkey; aqui ficam as regras do Mago OS.
 * Ver docs/decisoes/0011-dois-fatores.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";

/** "Confiar neste aparelho" vale 30 dias (spec M1-05). */
export const DIAS_APARELHO_CONFIAVEL = 30;
/** Ações perigosas pedem o segundo fator de novo se o último foi há mais de 10 minutos. */
export const MINUTOS_CONFIRMACAO_RECENTE = 10;

export type MetodoDoSegundoFator = "passkey" | "app" | "recuperacao" | "aparelho";

/** Caminhos em que o segundo fator acabou de ser conferido, e com qual método. */
export const CAMINHOS_QUE_CONFIRMAM = new Map<string, MetodoDoSegundoFator>([
  ["/two-factor/verify-totp", "app"],
  ["/two-factor/verify-backup-code", "recuperacao"],
  ["/passkey/verify-authentication", "passkey"],
  ["/passkey/verify-registration", "passkey"],
]);

/** Ações perigosas: só com o segundo fator recente, quando a pessoa já tem algum. */
export const ACOES_PERIGOSAS = new Set([
  "/change-password",
  "/change-email",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/delete-passkey",
]);

export interface SituacaoDosDoisFatores {
  /** Obrigatório e sem poder desligar: Dono da plataforma, administrador ou empresa que exige de todos. */
  obrigatorio: boolean;
  /** App autenticador ativado e confirmado. */
  appAutenticador: boolean;
  /** Quantas passkeys a pessoa tem. */
  passkeys: number;
  /** Só a passkey vale (piso da plataforma para administradores, ou empresa que exige de todos). */
  exigePasskey: boolean;
}

export async function situacaoDosDoisFatores(
  pool: pg.Pool,
  pessoaId: string,
): Promise<SituacaoDosDoisFatores> {
  const r = await pool.query<{ obrigatorio: boolean; app: boolean; passkeys: number; exige: boolean }>(
    `select acesso.dois_fatores_obrigatorio($1) as obrigatorio, acesso.exige_passkey($1) as exige,
            exists (select 1 from acesso.dois_fatores d join pessoas p on p.id = d.pessoa_id
                     where d.pessoa_id = $1 and d.verificado and p.dois_fatores_ativo) as app,
            (select count(*)::int from acesso.passkeys where pessoa_id = $1) as passkeys`,
    [pessoaId],
  );
  const linha = r.rows[0];
  return {
    obrigatorio: (linha?.obrigatorio ?? false) || (linha?.exige ?? false),
    appAutenticador: linha?.app ?? false,
    passkeys: linha?.passkeys ?? 0,
    exigePasskey: linha?.exige ?? false,
  };
}

/** Tem pelo menos uma forma de segundo fator pronta para usar. */
export function temSegundoFator(s: SituacaoDosDoisFatores): boolean {
  return s.exigePasskey ? s.passkeys > 0 : s.appAutenticador || s.passkeys > 0;
}

/**
 * A confirmação da sessão vale? Quando só a passkey vale, o código do app e o aparelho confiável não bastam;
 * o código de recuperação continua valendo, como saída de emergência para quem perdeu o aparelho.
 */
export function confirmacaoValida(s: SituacaoDosDoisFatores, metodo: MetodoDoSegundoFator | null): boolean {
  if (metodo === null) return false;
  return !s.exigePasskey || metodo === "passkey" || metodo === "recuperacao";
}

/** Precisa passar pelo segundo fator antes de ver dados: obrigatório, ou ativado por conta própria. */
export function precisaDoisFatores(s: SituacaoDosDoisFatores): boolean {
  return s.obrigatorio || s.appAutenticador;
}

export interface EstadoDaSessao {
  dois: SituacaoDosDoisFatores;
  /** Precisa do segundo fator. */
  precisa: boolean;
  /** Quando a sessão passou pelo segundo fator, se passou. */
  confirmadoEm: Date | null;
  /** Pode ver dados: não precisa, ou já passou pelo segundo fator. */
  completa: boolean;
  /** O que falta, para a tela saber o que mostrar. */
  falta: "nada" | "ativar" | "confirmar";
}

export function estadoDaSessao(
  dois: SituacaoDosDoisFatores,
  confirmadoEm: Date | null,
  metodo: MetodoDoSegundoFator | null = confirmadoEm ? "app" : null,
): EstadoDaSessao {
  const precisa = precisaDoisFatores(dois);
  const completa = !precisa || (confirmadoEm !== null && confirmacaoValida(dois, metodo));
  let falta: EstadoDaSessao["falta"] = "nada";
  if (!completa) falta = temSegundoFator(dois) ? "confirmar" : "ativar";
  // Obrigatório e sem nenhum segundo fator: só pode ativar, mesmo que a sessão tenha sido marcada por engano.
  if (dois.obrigatorio && !temSegundoFator(dois)) falta = "ativar";
  return { dois, precisa, confirmadoEm, completa: completa && falta === "nada", falta };
}

/** A ação perigosa pode seguir? Sim se a pessoa ainda não tem segundo fator, ou se confirmou há pouco. */
export function podeFazerAcaoPerigosa(
  dois: SituacaoDosDoisFatores,
  confirmadoEm: Date | null,
  metodo: MetodoDoSegundoFator | null,
  agora = Date.now(),
) {
  if (!temSegundoFator(dois)) return true;
  return (
    confirmadoEm !== null &&
    confirmacaoValida(dois, metodo) &&
    agora - confirmadoEm.getTime() <= MINUTOS_CONFIRMACAO_RECENTE * 60_000
  );
}

/** Marca que a sessão acabou de passar pelo segundo fator. */
export async function marcarConfirmacao(
  pool: pg.Pool,
  sessaoId: string,
  metodo: MetodoDoSegundoFator,
): Promise<void> {
  await pool.query(
    "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = $2 where id = $1",
    [sessaoId, metodo],
  );
}

/**
 * Confere o cookie "confiar neste aparelho" do Better Auth (o mesmo formato do plugin de 2FA), para valer também
 * no login com Google, que o plugin não cobre.
 */
export async function aparelhoConfiavel(
  valorDoCookie: string | null,
  pessoaId: string,
  segredo: string,
  acharVerificacao: (identificador: string) => Promise<{ value: string; expiresAt: Date } | null>,
): Promise<boolean> {
  if (!valorDoCookie) return false;
  const [token, identificador] = valorDoCookie.split("!");
  if (!token || !identificador) return false;
  const esperado = Buffer.from(
    createHmac("sha256", segredo).update(`${pessoaId}!${identificador}`).digest("base64url"),
  );
  const recebido = Buffer.from(token);
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return false;
  const registro = await acharVerificacao(identificador);
  return registro !== null && registro.value === pessoaId && registro.expiresAt > new Date();
}
