/**
 * Checklist da tarefa e subtarefas (M3-02).
 *
 * Checklist: itens de texto dentro da tarefa, com marcar e desmarcar, ordem e quem marcou.
 * Subtarefa (decisão 4 do Sandro, 19/11/2026): um nível só. A subtarefa é uma tarefa completa (responsável pessoa
 * ou agente, status, trava), ligada à tarefa-mãe pelo campo tarefaMaeId, no mesmo projeto e na mesma lista dela.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, Texto } from "../comum.ts";
import { Ordem } from "../projetos/lista.ts";
import { Autor } from "./tarefa.ts";

const TextoDoItem = Texto(500, "O passo, numa linha.");

export const ItemDeChecklist = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tarefaId: Id,
    texto: TextoDoItem,
    ordem: Ordem,
    marcado: Type.Boolean(),
    /** Quem marcou (pessoa ou agente). Nulo enquanto desmarcado. */
    marcadoPor: OuNulo(Autor),
    marcadoEm: OuNulo(DataHora),
    criadoEm: DataHora,
  },
  { additionalProperties: false, description: "Item do checklist de uma tarefa." },
);
export type ItemDeChecklist = Static<typeof ItemDeChecklist>;

export function conferirItemDeChecklist(valor: unknown) {
  return conferir(ItemDeChecklist, valor, [
    (i) =>
      i.marcado !== (i.marcadoPor !== null) || i.marcado !== (i.marcadoEm !== null)
        ? [{ caminho: "/marcadoPor", mensagem: "item marcado diz quem marcou e quando; desmarcado, não" }]
        : [],
    (i) =>
      i.marcadoPor?.tipo === "sistema"
        ? [{ caminho: "/marcadoPor", mensagem: "o sistema não marca itens" }]
        : [],
  ]);
}

/** Acrescentar um item ao fim do checklist. */
export const PedidoDeItemDeChecklist = Type.Object({ texto: TextoDoItem }, { additionalProperties: false });
export type PedidoDeItemDeChecklist = Static<typeof PedidoDeItemDeChecklist>;

/** Mudar o texto, a posição ou marcar e desmarcar um item. */
export const PedidoDeEditarItemDeChecklist = Type.Object(
  { texto: Type.Optional(TextoDoItem), ordem: Type.Optional(Ordem), marcado: Type.Optional(Type.Boolean()) },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarItemDeChecklist = Static<typeof PedidoDeEditarItemDeChecklist>;

/** Quantas subtarefas a tarefa tem e quantas estão prontas (concluídas ou canceladas). */
export const ResumoDasSubtarefas = Type.Object(
  { total: Type.Integer({ minimum: 0 }), prontas: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type ResumoDasSubtarefas = Static<typeof ResumoDasSubtarefas>;

/** Ações de auditoria do checklist e das subtarefas (M3-02). Nos detalhes vão ids, nunca o texto. */
export const ACOES_CHECKLIST = [
  "tarefa.criou_subtarefa",
  "tarefa.mudou_lista",
  "checklist.marcou",
  "checklist.editou",
] as const;
