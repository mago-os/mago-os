/**
 * Limites de cada execução e detecção de agente andando em círculo (M4-08, decisão 0030).
 *
 * Cada execução de agente interno tem um limite de rodadas (respostas do modelo) e de tempo; o administrador ajusta
 * por agente. O núcleo também para o agente que repete a mesma ferramenta com os mesmos parâmetros três vezes seguidas
 * e os dois agentes que passam a mesma tarefa um para o outro três vezes. Ao parar, a tarefa vai para "precisa de
 * ajuda" e o responsável pelo agente recebe o aviso com o resumo.
 */
import { type Static, Type } from "typebox";
import { OuNulo } from "../comum.ts";

export const LIMITE_PADRAO_DE_RODADAS = 30;
export const LIMITE_PADRAO_DE_MINUTOS = 10;
export const MAXIMO_DE_RODADAS = 100;
export const MAXIMO_DE_MINUTOS = 60;
/** A mesma ferramenta com os mesmos parâmetros, tantas vezes seguidas: a última não roda e o agente para. */
export const REPETICOES_PARA_PARAR = 3;
/** A mesma tarefa passando entre os mesmos dois agentes, tantas vezes em 24 horas: o agente não começa. */
export const PASSADAS_PARA_PARAR = 3;

/** Os limites de um agente, como a tela mostra (o padrão quando não foi ajustado). */
export const LimitesDoAgente = Type.Object(
  {
    rodadas: Type.Integer({ minimum: 1, maximum: MAXIMO_DE_RODADAS }),
    minutos: Type.Integer({ minimum: 1, maximum: MAXIMO_DE_MINUTOS }),
    ajustados: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type LimitesDoAgente = Static<typeof LimitesDoAgente>;

/** Mudar os limites de um agente (null: volta ao padrão). */
export const PedidoDeLimites = Type.Object(
  {
    rodadas: OuNulo(Type.Integer({ minimum: 1, maximum: MAXIMO_DE_RODADAS })),
    minutos: OuNulo(Type.Integer({ minimum: 1, maximum: MAXIMO_DE_MINUTOS })),
  },
  { additionalProperties: false },
);
export type PedidoDeLimites = Static<typeof PedidoDeLimites>;

/** Por que o núcleo parou o agente no meio. */
export const MOTIVOS_DA_PARADA = ["rodadas", "tempo", "repeticao", "vai_e_volta", "teto"] as const;
export type MotivoDaParada = (typeof MOTIVOS_DA_PARADA)[number];

/** Ações de auditoria. */
export const ACOES_LIMITES = [
  "agente.mudou_limites",
  "agente.parou_no_limite",
  "agente.andou_em_circulo",
] as const;
