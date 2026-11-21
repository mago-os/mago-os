/**
 * Custo de cada chamada ao modelo e tetos de gasto por mês (M4-06, decisão 0028).
 *
 * Cada chamada guarda os tokens (entrada, saída e cache) e o custo, pela tabela de preços de referência (no código,
 * atualizada por nós) ou pelo preço que o administrador deu ao modelo. A conta por assinatura não tem custo por uso:
 * conta os tokens com custo zero. Antes de cada execução, o núcleo confere três tetos do mês (empresa, agente e a
 * conta de IA): aos 80% avisa uma vez; aos 100% a execução não começa.
 *
 * Unidades: preço em centavos de dólar por milhão de tokens; custo em microdólares (US$ 0,000001); teto em centavos.
 */
import { type Static, Type } from "typebox";
import { Dia, Id, OuNulo, Texto } from "../comum.ts";
import { TetoMensal } from "./contas-de-ia.ts";

export const PrecoDeModelo = Type.Object(
  {
    entrada: Type.Integer({
      minimum: 0,
      maximum: 1_000_000,
      description: "Centavos por milhão de tokens de entrada.",
    }),
    saida: Type.Integer({
      minimum: 0,
      maximum: 1_000_000,
      description: "Centavos por milhão de tokens de saída.",
    }),
    cache: Type.Integer({
      minimum: 0,
      maximum: 1_000_000,
      description: "Centavos por milhão de tokens lidos do cache.",
    }),
  },
  { additionalProperties: false },
);
export type PrecoDeModelo = Static<typeof PrecoDeModelo>;

/**
 * Preços de referência, pelo começo do nome do modelo (o primeiro que casar vale). Atualizados por nós; quando
 * estiverem desatualizados, o administrador dá o preço do modelo na conta de IA.
 */
export const PRECOS_DE_REFERENCIA: readonly { comeco: string; preco: PrecoDeModelo }[] = [
  { comeco: "claude-opus", preco: { entrada: 500, saida: 2500, cache: 50 } },
  { comeco: "claude-sonnet", preco: { entrada: 300, saida: 1500, cache: 30 } },
  { comeco: "claude-haiku", preco: { entrada: 100, saida: 500, cache: 10 } },
  { comeco: "gpt-5-nano", preco: { entrada: 5, saida: 40, cache: 1 } },
  { comeco: "gpt-5-mini", preco: { entrada: 25, saida: 200, cache: 3 } },
  { comeco: "gpt-5", preco: { entrada: 125, saida: 1000, cache: 13 } },
  { comeco: "deepseek", preco: { entrada: 28, saida: 42, cache: 3 } },
];

/**
 * Sem preço de referência nem do administrador, o custo usa o maior preço da tabela: assim o teto continua
 * protegendo, e a tela avisa que o modelo está sem preço.
 */
export const PRECO_SEM_REFERENCIA: PrecoDeModelo = { entrada: 500, saida: 2500, cache: 50 };

export function precoDeReferencia(modelo: string): PrecoDeModelo | null {
  const nome = modelo.toLowerCase().replace(/^.*\//, "");
  return PRECOS_DE_REFERENCIA.find((p) => nome.startsWith(p.comeco))?.preco ?? null;
}

/** Custo em microdólares (inteiro, arredondado para cima). */
export function custoEmMicros(
  tokens: { entrada: number; saida: number; cache: number },
  preco: PrecoDeModelo,
): number {
  // centavos por milhão de tokens → microdólares por token = centavos / 100.
  return Math.ceil(
    (tokens.entrada * preco.entrada + tokens.saida * preco.saida + tokens.cache * preco.cache) / 100,
  );
}

/** O preço que o administrador dá a um modelo de uma conta (null: volta para a referência). */
export const PedidoDePrecoDoModelo = Type.Object(
  { modelo: Texto(120, "O modelo."), preco: OuNulo(PrecoDeModelo) },
  { additionalProperties: false },
);
export type PedidoDePrecoDoModelo = Static<typeof PedidoDePrecoDoModelo>;

/** Tetos padrão (decisão 10 da spec do M4): US$ 50 por mês na empresa e US$ 20 por agente. */
export const TETO_PADRAO_DA_EMPRESA = 5000;
export const TETO_PADRAO_DO_AGENTE = 2000;
/** Percentual do teto em que o responsável é avisado (uma vez por mês). */
export const PERCENTUAL_DE_AVISO = 80;

/**
 * Conta por assinatura: em vez de teto em dólar, um limite de aviso em tokens por mês. Aos 80% e aos 100%, o
 * administrador é avisado; nada é bloqueado (o próprio plano tem o limite dele, e aí o agente passa ao reserva).
 */
export const AvisoDeTokens = Type.Integer({
  minimum: 1000,
  maximum: 100_000_000_000,
  description: "Tokens por mês a partir dos quais o administrador é avisado (sem bloquear).",
});
export const PedidoDeAvisoDeTokens = Type.Object(
  { tokens: OuNulo(AvisoDeTokens) },
  { additionalProperties: false },
);
export type PedidoDeAvisoDeTokens = Static<typeof PedidoDeAvisoDeTokens>;

/** Mudar um teto (null: sem teto). */
export const PedidoDeTeto = Type.Object({ teto: OuNulo(TetoMensal) }, { additionalProperties: false });
export type PedidoDeTeto = Static<typeof PedidoDeTeto>;

const Gasto = Type.Object(
  {
    /** Microdólares no período. */
    custo: Type.Integer({ minimum: 0 }),
    tokens: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** O painel de custos de um mês (no fuso da empresa). */
export const ResumoDeCustos = Type.Object(
  {
    mes: Type.String({ pattern: "^\\d{4}-\\d{2}$" }),
    total: Gasto,
    hoje: Gasto,
    tetoDaEmpresa: OuNulo(TetoMensal),
    porAgente: Type.Array(
      Type.Object(
        {
          agenteId: Id,
          nome: Type.String(),
          teto: OuNulo(TetoMensal),
          mes: Gasto,
          hoje: Gasto,
        },
        { additionalProperties: false },
      ),
    ),
    porConta: Type.Array(
      Type.Object(
        {
          contaId: Id,
          nome: Type.String(),
          /** Chave de API: teto em dólar. Assinatura: não tem teto; tem o aviso em tokens. */
          teto: OuNulo(TetoMensal),
          avisoDeTokens: OuNulo(AvisoDeTokens),
          mes: Gasto,
        },
        { additionalProperties: false },
      ),
    ),
    porDia: Type.Array(
      Type.Object({ dia: Dia, custo: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    ),
    /** Modelos usados no mês sem preço (de referência nem do administrador): o custo usou o maior preço. */
    semPreco: Type.Array(
      Type.Object({ contaId: Id, modelo: Type.String() }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
export type ResumoDeCustos = Static<typeof ResumoDeCustos>;

/** Ações de auditoria dos custos. */
export const ACOES_CUSTOS = [
  "custos.mudou_teto",
  "custos.mudou_aviso_de_tokens",
  "custos.mudou_preco",
  "agente.parou_no_teto",
] as const;
