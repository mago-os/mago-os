/**
 * Visões salvas (M3-04): cada pessoa guarda uma visão das tarefas com os filtros, com nome ("Minhas tarefas desta
 * semana"), e ela aparece no menu. Decisão 9 do Sandro (19/11/2026): pessoais no M3; compartilhar fica para a Fase 2.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, Texto } from "../comum.ts";
import { FiltroDeTarefas } from "./tarefa.ts";

export const TIPOS_DE_VISAO = ["lista", "kanban", "calendario"] as const;
export const TipoDeVisao = Type.Enum(TIPOS_DE_VISAO, { description: "lista, kanban ou calendario." });
export type TipoDeVisao = Static<typeof TipoDeVisao>;

export const AGRUPAMENTOS = ["status", "lista", "responsavel", "prioridade", "prazo"] as const;
export const Agrupamento = Type.Enum(AGRUPAMENTOS, { description: "Como a lista agrupa as tarefas." });
export type Agrupamento = Static<typeof Agrupamento>;

const NomeDaVisao = Texto(80, "Nome da visão (ex.: Atrasadas do Mago OS).");

export const VisaoSalva = Type.Object(
  {
    id: Id,
    empresaId: Id,
    pessoaId: Id,
    nome: NomeDaVisao,
    tipo: TipoDeVisao,
    /** Os filtros (projeto, espaço, responsáveis, prazo...). */
    filtro: FiltroDeTarefas,
    /** Só na lista. */
    agruparPor: OuNulo(Agrupamento),
    criadaEm: DataHora,
  },
  { additionalProperties: false, description: "Visão das tarefas salva por uma pessoa, só dela." },
);
export type VisaoSalva = Static<typeof VisaoSalva>;

export function conferirVisaoSalva(valor: unknown) {
  return conferir(VisaoSalva, valor);
}

export const PedidoDeVisaoSalva = Type.Object(
  {
    nome: NomeDaVisao,
    tipo: TipoDeVisao,
    filtro: FiltroDeTarefas,
    agruparPor: Type.Optional(OuNulo(Agrupamento)),
  },
  { additionalProperties: false },
);
export type PedidoDeVisaoSalva = Static<typeof PedidoDeVisaoSalva>;
