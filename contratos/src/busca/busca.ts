/**
 * Busca Ctrl+K (M3-09): uma caixa só para achar tarefas, comentários, projetos, espaços, pessoas e agentes.
 * Busca de texto do PostgreSQL em português, sem acento e tolerante a erro de digitação (pg_trgm), sempre com a
 * permissão de quem busca (a mesma regra das listas). A busca por significado (pgvector) vem com a memória da
 * empresa, na Fase 2 (decisão 15). Os comandos rápidos ("nova tarefa", "abrir agentes"...) são da tela.
 */
import { type Static, Type } from "typebox";
import { Id, OuNulo, Texto } from "../comum.ts";

/** Na ordem em que os grupos aparecem. */
export const TIPOS_DE_RESULTADO = ["tarefa", "comentario", "projeto", "espaco", "pessoa", "agente"] as const;
export const TipoDeResultado = Type.Enum(TIPOS_DE_RESULTADO, {
  description: "tarefa, comentario, projeto, espaco, pessoa ou agente.",
});
export type TipoDeResultado = Static<typeof TipoDeResultado>;

/** Resultados no máximo, por tipo e no total. */
export const RESULTADOS_POR_TIPO = 5;

export const PedidoDeBusca = Type.Object(
  {
    texto: Type.String({ minLength: 2, maxLength: 100, description: "O que procurar (2 a 100 caracteres)." }),
    /** Só estes tipos (padrão: todos os que a pessoa pode ver). */
    tipos: Type.Optional(Type.Array(TipoDeResultado, { minItems: 1, uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type PedidoDeBusca = Static<typeof PedidoDeBusca>;

export const ResultadoDaBusca = Type.Object(
  {
    tipo: TipoDeResultado,
    id: Id,
    /** Título da tarefa, nome do projeto, da pessoa... (no comentário, o título da tarefa). */
    titulo: Texto(500, "O que foi achado."),
    /** Um pedaço do texto em volta do que foi achado (comentário, descrição), só texto. */
    trecho: OuNulo(Texto(300, "Trecho com o que foi achado.")),
    link: Texto(300, "Para onde abrir."),
  },
  { additionalProperties: false, description: "Um resultado da busca." },
);
export type ResultadoDaBusca = Static<typeof ResultadoDaBusca>;

export const RespostaDaBusca = Type.Object(
  {
    /** Agrupados por tipo (na ordem de TIPOS_DE_RESULTADO) e, em cada grupo, do mais parecido para o menos. */
    resultados: Type.Array(ResultadoDaBusca, { maxItems: TIPOS_DE_RESULTADO.length * RESULTADOS_POR_TIPO }),
  },
  { additionalProperties: false },
);
export type RespostaDaBusca = Static<typeof RespostaDaBusca>;
