/**
 * O passo a passo de cada execução (M4-07, decisão 0029): o que o agente disse ao modelo devolver, cada ferramenta
 * chamada com os parâmetros e o resultado, os pedidos de aprovação, os avisos do sistema, e os tokens, o custo e o
 * tempo de cada passo. Os agentes externos aparecem pelo que fizeram pelo MCP (sem o raciocínio, que fica na máquina
 * deles). Os passos ficam 90 dias; depois, só o resumo da execução (custo, tokens, duração e resultado).
 *
 * Texto de agente e resultados de ferramenta aparecem só como texto, nunca como HTML.
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo } from "../comum.ts";
import { ExecucaoDeAgente } from "./internos.ts";

/** Dias que o passo a passo fica guardado (decisão 11 da spec do M4). */
export const DIAS_DOS_PASSOS = 90;
/** Caracteres de cada parâmetro ou resultado guardado; acima disso, corta e marca. */
export const CARACTERES_POR_PASSO = 20_000;

/** modelo: uma resposta do modelo; ferramenta: uma ferramenta chamada; sistema: um aviso (reserva, teto, limite). */
export const TIPOS_DE_PASSO = ["modelo", "ferramenta", "sistema"] as const;
export const TipoDePasso = Type.Enum(TIPOS_DE_PASSO);
export type TipoDePasso = Static<typeof TipoDePasso>;

const Tokens = Type.Object(
  {
    entrada: Type.Integer({ minimum: 0 }),
    saida: Type.Integer({ minimum: 0 }),
    cache: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PassoDaExecucao = Type.Object(
  {
    id: Id,
    /** A ordem dentro da execução (ou da atividade do agente externo na tarefa). */
    numero: Type.Integer({ minimum: 1 }),
    tipo: TipoDePasso,
    criadoEm: DataHora,
    duracaoMs: OuNulo(Type.Integer({ minimum: 0 })),
    /** modelo: o modelo que respondeu. */
    modelo: OuNulo(Type.String({ maxLength: 120 })),
    /** modelo: o texto que o modelo devolveu; sistema: o aviso. Só texto. */
    texto: OuNulo(Type.String({ maxLength: CARACTERES_POR_PASSO })),
    /** ferramenta: o nome. modelo: as ferramentas que o modelo pediu, separadas por vírgula. */
    ferramenta: OuNulo(Type.String({ maxLength: 400 })),
    /** ferramenta: os parâmetros e o resultado (cortados acima do limite). Nulos para quem só vê o resumo. */
    entrada: Type.Unknown(),
    resultado: Type.Unknown(),
    /** A ferramenta recusou ou falhou (o resultado é a mensagem). */
    erro: Type.Boolean(),
    /** Parâmetros ou resultado passaram do limite e foram cortados. */
    cortado: Type.Boolean(),
    tokens: OuNulo(Tokens),
    /** Microdólares do passo (modelo). */
    custo: OuNulo(Type.Integer({ minimum: 0 })),
    /** O pedido de aprovação que o passo criou. */
    aprovacaoId: OuNulo(Id),
  },
  { additionalProperties: false },
);
export type PassoDaExecucao = Static<typeof PassoDaExecucao>;

/** Uma execução com o resumo (sempre) e os passos (até 90 dias). */
export const DetalheDaExecucao = Type.Object(
  {
    execucao: ExecucaoDeAgente,
    agenteNome: Type.String(),
    pedidoPorNome: Type.String(),
    duracaoMs: OuNulo(Type.Integer({ minimum: 0 })),
    tokens: Tokens,
    custo: Type.Integer({ minimum: 0 }),
    /** Quem pediu, o responsável pelo agente e o administrador veem parâmetros e resultados; os outros, o resumo. */
    comDetalhes: Type.Boolean(),
    /** Passou de 90 dias: os passos foram apagados e fica só o resumo. */
    passosApagados: Type.Boolean(),
    passos: Type.Array(PassoDaExecucao),
  },
  { additionalProperties: false },
);
export type DetalheDaExecucao = Static<typeof DetalheDaExecucao>;

/** Uma linha das listas (na tarefa, na página do agente). */
export const ExecucaoNaLista = Type.Object(
  {
    id: Id,
    agenteId: Id,
    agenteNome: Type.String(),
    origem: Type.String(),
    situacao: Type.String(),
    tarefaId: OuNulo(Id),
    resumo: OuNulo(Type.String()),
    criadaEm: DataHora,
    duracaoMs: OuNulo(Type.Integer({ minimum: 0 })),
    custo: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ExecucaoNaLista = Static<typeof ExecucaoNaLista>;

/** O que um agente externo fez pelo MCP numa tarefa: as chamadas de ferramenta, em ordem. */
export const AtividadeExterna = Type.Object(
  {
    agenteId: Id,
    agenteNome: Type.String(),
    comDetalhes: Type.Boolean(),
    passos: Type.Array(PassoDaExecucao),
  },
  { additionalProperties: false },
);
export type AtividadeExterna = Static<typeof AtividadeExterna>;
