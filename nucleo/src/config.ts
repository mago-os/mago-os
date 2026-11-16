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
  };
}
