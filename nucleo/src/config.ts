import { lerChaveMestra } from "./contas-de-ia/cofre.ts";

/**
 * Configuração do núcleo, lida só de variáveis de ambiente (nada fica guardado no servidor).
 * Em teste e produção os valores vêm do Infisical (M0-08); no Mac, do ambiente local.
 */

export type NivelDeRegistro = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface Config {
  /** Porta onde a API escuta. Variável PORTA, padrão 3000. */
  porta: number;
  /** Endereço onde a API escuta. Variável HOST, padrão 0.0.0.0 (dentro do container). */
  host: string;
  /** Endereço do banco PostgreSQL. Variável DATABASE_URL, obrigatória. */
  bancoUrl: string;
  /** Quanto detalhe vai para os registros. Variável NIVEL_REGISTRO, padrão info. */
  nivelRegistro: NivelDeRegistro;
  /** Nome do ambiente: local, teste ou producao. Variável AMBIENTE, padrão local. */
  ambiente: "local" | "teste" | "producao";
  /** Versão publicada (o commit da imagem). Variável MAGO_VERSAO, gravada na imagem pelo GitHub; padrão "local". */
  versao: string;
  /** Login (M1-03). Obrigatório em teste e produção; no Mac, só liga se DATABASE_URL_ACESSO for informada. */
  acesso: ConfigDoAcesso | null;
  /** Anexos (M3-08). Nulo fora do Mac quando o depósito não foi configurado: os anexos ficam desligados. */
  anexos: ConfigDosAnexos | null;
  /**
   * Cofre das contas de IA (M4-01, decisão 0021). Variável MAGO_COFRE_CHAVE_MESTRA (32 bytes em base64) e
   * MAGO_COFRE_VERSAO (padrão 1); na troca da mestra, a anterior em MAGO_COFRE_CHAVE_ANTERIOR. Sem a chave fora do
   * Mac, as contas de IA ficam desligadas. No Mac, sem ela, uma chave fixa só para dados falsos.
   */
  cofre: ConfigDoCofre | null;
}

export interface ConfigDoCofre {
  atual: { versao: number; chave: Buffer };
  anteriores: { versao: number; chave: Buffer }[];
  /** A chave fixa do Mac (só dados falsos). */
  deTeste: boolean;
}

/** Chave fixa do Mac: só para dados falsos, nunca vale fora do ambiente local. */
const CHAVE_MESTRA_DO_MAC = Buffer.alloc(32, "mago-os-so-no-mac");

export interface ConfigDosAnexos {
  /**
   * Bucket compatível com S3 (Backblaze B2). Variáveis MAGO_ANEXOS_ENDPOINT, MAGO_ANEXOS_BUCKET,
   * MAGO_ANEXOS_CHAVE_ID e MAGO_ANEXOS_CHAVE_SEGREDO, as quatro ou nenhuma. Sem elas, no Mac, uma pasta do computador.
   */
  deposito:
    | { tipo: "s3"; endpoint: string; bucket: string; chaveId: string; chaveSegredo: string }
    | { tipo: "disco" };
  /** O ClamAV ("host:porta"). Variável MAGO_CLAMAV; obrigatória fora do Mac. No Mac, sem ela, o conferente de teste. */
  clamav: string | null;
}

export interface ConfigDoAcesso {
  /** Conexão com o papel mago_acesso. Variável DATABASE_URL_ACESSO. */
  bancoUrl: string;
  /** Segredo que assina os cookies, com pelo menos 32 caracteres. Variável MAGO_ACESSO_SEGREDO. */
  segredo: string;
  /** Endereço público do site, sem /api (ex.: https://teste.osmago.com). Variável MAGO_URL_PUBLICA. */
  urlPublica: string;
  /** Recusar senhas que já vazaram. Variável MAGO_SENHAS_VAZADAS: "conferir" (padrão) ou "nao_conferir". */
  conferirSenhasVazadas: boolean;
  /** Chave do Resend (só envio) para os e-mails do sistema. Variável MAGO_RESEND_CHAVE; sem ela, o link vai para o log. */
  resend: string | null;
  /** Login com Google. Variáveis MAGO_GOOGLE_ID e MAGO_GOOGLE_SEGREDO, as duas ou nenhuma. */
  google: { id: string; segredo: string } | null;
  /**
   * Push (M3-06): chaves VAPID. Variáveis MAGO_VAPID_PUBLICA e MAGO_VAPID_PRIVADA, as duas ou nenhuma; sem elas, o
   * push fica desligado (o sino continua).
   */
  vapid: { publica: string; privada: string; assunto: string } | null;
}

const NIVEIS: readonly NivelDeRegistro[] = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const AMBIENTES: readonly Config["ambiente"][] = ["local", "teste", "producao"];

/** Erro de configuração: a API não sobe e diz exatamente o que falta. */
export class ErroDeConfig extends Error {
  override name = "ErroDeConfig";
}

export function lerConfig(env: Record<string, string | undefined> = process.env): Config {
  const problemas: string[] = [];

  const porta = Number(env.PORTA ?? "3000");
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    problemas.push(`PORTA precisa ser um número entre 1 e 65535 (veio "${env.PORTA}")`);
  }

  const bancoUrl = env.DATABASE_URL ?? "";
  if (bancoUrl === "") {
    problemas.push("DATABASE_URL não foi informada");
  } else if (!/^postgres(ql)?:\/\//.test(bancoUrl)) {
    problemas.push("DATABASE_URL precisa começar com postgres://");
  }

  const nivelRegistro = (env.NIVEL_REGISTRO ?? "info") as NivelDeRegistro;
  if (!NIVEIS.includes(nivelRegistro)) {
    problemas.push(`NIVEL_REGISTRO precisa ser um destes: ${NIVEIS.join(", ")}`);
  }

  const ambiente = (env.AMBIENTE ?? "local") as Config["ambiente"];
  if (!AMBIENTES.includes(ambiente)) {
    problemas.push(`AMBIENTE precisa ser um destes: ${AMBIENTES.join(", ")}`);
  }

  const acesso = lerAcesso(env, ambiente, problemas);
  const anexos = lerAnexos(env, ambiente, problemas);
  const cofre = lerCofre(env, ambiente, problemas);

  if (problemas.length > 0) {
    throw new ErroDeConfig(`Configuração inválida:\n- ${problemas.join("\n- ")}`);
  }

  return {
    porta,
    host: env.HOST ?? "0.0.0.0",
    bancoUrl,
    nivelRegistro,
    ambiente,
    versao: env.MAGO_VERSAO ?? "local",
    acesso,
    anexos,
    cofre,
  };
}

function lerCofre(
  env: Record<string, string | undefined>,
  ambiente: Config["ambiente"],
  problemas: string[],
): ConfigDoCofre | null {
  const texto = env.MAGO_COFRE_CHAVE_MESTRA?.trim() ?? "";
  const versao = Number(env.MAGO_COFRE_VERSAO ?? "1");
  if (!Number.isInteger(versao) || versao < 1) {
    problemas.push("MAGO_COFRE_VERSAO precisa ser um número inteiro a partir de 1");
    return null;
  }
  if (texto === "") {
    return ambiente === "local"
      ? { atual: { versao: 1, chave: CHAVE_MESTRA_DO_MAC }, anteriores: [], deTeste: true }
      : null;
  }
  const atual = lerChaveMestra(texto, versao);
  if (!atual) {
    problemas.push("MAGO_COFRE_CHAVE_MESTRA precisa ter 32 bytes em base64 (openssl rand -base64 32)");
    return null;
  }
  const anteriores: ConfigDoCofre["anteriores"] = [];
  const anterior = env.MAGO_COFRE_CHAVE_ANTERIOR?.trim() ?? "";
  if (anterior !== "") {
    const chaveAnterior = versao >= 2 ? lerChaveMestra(anterior, versao - 1) : null;
    if (!chaveAnterior)
      problemas.push(
        "MAGO_COFRE_CHAVE_ANTERIOR precisa ter 32 bytes em base64, com MAGO_COFRE_VERSAO 2 ou mais",
      );
    else anteriores.push(chaveAnterior);
  }
  return { atual, anteriores, deTeste: false };
}

function lerAnexos(
  env: Record<string, string | undefined>,
  ambiente: Config["ambiente"],
  problemas: string[],
): ConfigDosAnexos | null {
  const v = (n: string) => env[n]?.trim() ?? "";
  const nomes = [
    "MAGO_ANEXOS_ENDPOINT",
    "MAGO_ANEXOS_BUCKET",
    "MAGO_ANEXOS_CHAVE_ID",
    "MAGO_ANEXOS_CHAVE_SEGREDO",
  ];
  const informados = nomes.filter((n) => v(n) !== "");
  const clamav = v("MAGO_CLAMAV") || null;
  if (clamav && !/^[a-zA-Z0-9.-]+:\d{1,5}$/.test(clamav))
    problemas.push('MAGO_CLAMAV precisa ser "host:porta"');
  if (informados.length > 0 && informados.length < nomes.length) {
    problemas.push(`Anexos: informe ${nomes.join(", ")} juntas`);
    return null;
  }
  if (informados.length === 0) return ambiente === "local" ? { deposito: { tipo: "disco" }, clamav } : null;
  // O endpoint pode vir sem o https:// (como o Backblaze mostra).
  const endpoint = /^https?:\/\//.test(v("MAGO_ANEXOS_ENDPOINT"))
    ? v("MAGO_ANEXOS_ENDPOINT")
    : `https://${v("MAGO_ANEXOS_ENDPOINT")}`;
  if (!clamav && ambiente !== "local")
    problemas.push("MAGO_CLAMAV é obrigatória com os anexos ligados fora do Mac");
  return {
    deposito: {
      tipo: "s3",
      endpoint,
      bucket: v("MAGO_ANEXOS_BUCKET"),
      chaveId: v("MAGO_ANEXOS_CHAVE_ID"),
      chaveSegredo: v("MAGO_ANEXOS_CHAVE_SEGREDO"),
    },
    clamav,
  };
}

function lerAcesso(
  env: Record<string, string | undefined>,
  ambiente: Config["ambiente"],
  problemas: string[],
): ConfigDoAcesso | null {
  const bancoUrl = env.DATABASE_URL_ACESSO ?? "";
  if (bancoUrl === "" && ambiente === "local") return null;
  if (bancoUrl === "")
    problemas.push("DATABASE_URL_ACESSO não foi informada (o login é obrigatório fora do Mac)");
  else if (!/^postgres(ql)?:\/\//.test(bancoUrl))
    problemas.push("DATABASE_URL_ACESSO precisa começar com postgres://");

  const segredo = env.MAGO_ACESSO_SEGREDO ?? "";
  if (segredo.length < 32) problemas.push("MAGO_ACESSO_SEGREDO precisa ter pelo menos 32 caracteres");

  const urlPublica = env.MAGO_URL_PUBLICA ?? "";
  if (!/^https?:\/\/[^/]+$/.test(urlPublica)) {
    problemas.push(
      "MAGO_URL_PUBLICA precisa ser o endereço do site, sem barra no fim (ex.: https://teste.osmago.com)",
    );
  } else if (ambiente !== "local" && !urlPublica.startsWith("https://")) {
    problemas.push("MAGO_URL_PUBLICA precisa ser https fora do Mac");
  }

  const vazadas = env.MAGO_SENHAS_VAZADAS ?? "conferir";
  if (vazadas !== "conferir" && vazadas !== "nao_conferir") {
    problemas.push('MAGO_SENHAS_VAZADAS precisa ser "conferir" ou "nao_conferir"');
  } else if (vazadas === "nao_conferir" && ambiente !== "local") {
    problemas.push("MAGO_SENHAS_VAZADAS só pode ser desligada no Mac");
  }

  const googleId = env.MAGO_GOOGLE_ID ?? "";
  const googleSegredo = env.MAGO_GOOGLE_SEGREDO ?? "";
  if ((googleId === "") !== (googleSegredo === "")) {
    problemas.push("Login com Google: informe MAGO_GOOGLE_ID e MAGO_GOOGLE_SEGREDO juntos");
  }
  const google = googleId && googleSegredo ? { id: googleId, segredo: googleSegredo } : null;

  const resend = env.MAGO_RESEND_CHAVE?.trim() || null;
  if (resend && !resend.startsWith("re_")) problemas.push("MAGO_RESEND_CHAVE precisa começar com re_");

  const vapidPublica = env.MAGO_VAPID_PUBLICA?.trim() ?? "";
  const vapidPrivada = env.MAGO_VAPID_PRIVADA?.trim() ?? "";
  if ((vapidPublica === "") !== (vapidPrivada === "")) {
    problemas.push("Push: informe MAGO_VAPID_PUBLICA e MAGO_VAPID_PRIVADA juntas");
  }
  const vapid =
    vapidPublica && vapidPrivada
      ? { publica: vapidPublica, privada: vapidPrivada, assunto: "mailto:nao-responda@osmago.com" }
      : null;

  return {
    bancoUrl,
    segredo,
    urlPublica,
    conferirSenhasVazadas: vazadas !== "nao_conferir",
    google,
    resend,
    vapid,
  };
}
