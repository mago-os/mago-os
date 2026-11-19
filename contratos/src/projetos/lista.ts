/**
 * Listas e status do projeto (M3-02).
 *
 * Lista: etapa ou frente do projeto (Planejamento, Execução, Entrega). Todo projeto nasce com a lista "Geral", e
 * toda tarefa de projeto fica numa lista.
 *
 * Status do projeto (decisão 3 do Sandro, 19/11/2026): cada projeto define os próprios status, com nome, cor e
 * ordem, e cada um pertence a um dos cinco tipos fixos do M2 (A fazer, Em andamento, Precisa de ajuda, Concluída,
 * Cancelada). A trava, o agente vivo e o MCP continuam olhando o tipo. Todo projeto tem pelo menos um status de
 * cada tipo, para uma tarefa sempre ter para onde ir. Projeto novo nasce com os cinco status padrão.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, type Problema, Texto } from "../comum.ts";
import { NOMES_STATUS_TAREFA, STATUS_TAREFA, StatusTarefa } from "../tarefas/tarefa.ts";
import { Cor } from "./projeto.ts";

const NomeDaLista = Texto(80, "Nome da lista (ex.: Planejamento).");
const NomeDoStatus = Texto(40, "Nome do status como aparece nas telas (ex.: Em revisão).");

/** Posição na tela, do menor para o maior. */
export const Ordem = Type.Integer({
  minimum: 0,
  maximum: 100000,
  description: "Posição, do menor para o maior.",
});

export const NOME_DA_LISTA_PADRAO = "Geral";

export const Lista = Type.Object(
  {
    id: Id,
    empresaId: Id,
    projetoId: Id,
    nome: NomeDaLista,
    ordem: Ordem,
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Lista (etapa ou frente) de um projeto." },
);
export type Lista = Static<typeof Lista>;

export function conferirLista(valor: unknown) {
  return conferir(Lista, valor);
}

export const StatusDoProjeto = Type.Object(
  {
    id: Id,
    empresaId: Id,
    projetoId: Id,
    nome: NomeDoStatus,
    cor: Cor,
    /** Um dos cinco tipos fixos: é o que a trava, o agente vivo e o MCP olham. */
    tipo: StatusTarefa,
    ordem: Ordem,
  },
  { additionalProperties: false, description: "Status de um projeto, ligado a um dos cinco tipos fixos." },
);
export type StatusDoProjeto = Static<typeof StatusDoProjeto>;

export function conferirStatusDoProjeto(valor: unknown) {
  return conferir(StatusDoProjeto, valor);
}

/** Os cinco status com que todo projeto nasce, na ordem. */
export const STATUS_PADRAO_DO_PROJETO: { nome: string; cor: string; tipo: StatusTarefa }[] = [
  { nome: NOMES_STATUS_TAREFA.a_fazer, cor: "#64748b", tipo: "a_fazer" },
  { nome: NOMES_STATUS_TAREFA.em_andamento, cor: "#3b82f6", tipo: "em_andamento" },
  { nome: NOMES_STATUS_TAREFA.precisa_de_ajuda, cor: "#ef4444", tipo: "precisa_de_ajuda" },
  { nome: NOMES_STATUS_TAREFA.concluida, cor: "#10b981", tipo: "concluida" },
  { nome: NOMES_STATUS_TAREFA.cancelada, cor: "#94a3b8", tipo: "cancelada" },
];

/** Criar uma lista no projeto (vai para o fim). */
export const PedidoDeLista = Type.Object({ nome: NomeDaLista }, { additionalProperties: false });
export type PedidoDeLista = Static<typeof PedidoDeLista>;

/** Renomear ou mudar a lista de posição. */
export const PedidoDeEditarLista = Type.Object(
  { nome: Type.Optional(NomeDaLista), ordem: Type.Optional(Ordem) },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarLista = Static<typeof PedidoDeEditarLista>;

/**
 * Os status do projeto, todos de uma vez, na ordem em que aparecem. Status com id é mantido (e renomeado);
 * sem id é novo; o que ficou de fora é apagado, e as tarefas dele passam para o primeiro status do mesmo tipo.
 */
export const PedidoDeStatusDoProjeto = Type.Object(
  {
    status: Type.Array(
      Type.Object(
        { id: Type.Optional(Id), nome: NomeDoStatus, cor: Cor, tipo: StatusTarefa },
        { additionalProperties: false },
      ),
      { minItems: STATUS_TAREFA.length, maxItems: 30 },
    ),
  },
  { additionalProperties: false },
);
export type PedidoDeStatusDoProjeto = Static<typeof PedidoDeStatusDoProjeto>;

export function conferirPedidoDeStatusDoProjeto(valor: unknown) {
  return conferir(PedidoDeStatusDoProjeto, valor, [
    (p): Problema[] => {
      const problemas: Problema[] = [];
      for (const tipo of STATUS_TAREFA) {
        if (!p.status.some((s) => s.tipo === tipo)) {
          problemas.push({ caminho: "/status", mensagem: `falta um status do tipo ${tipo}` });
        }
      }
      const nomes = p.status.map((s) => s.nome.trim().toLowerCase());
      if (new Set(nomes).size !== nomes.length)
        problemas.push({ caminho: "/status", mensagem: "nome repetido" });
      const ids = p.status.flatMap((s) => (s.id ? [s.id] : []));
      if (new Set(ids).size !== ids.length)
        problemas.push({ caminho: "/status", mensagem: "status repetido" });
      return problemas;
    },
  ]);
}

/** Mudar a tarefa de lista, dentro do mesmo projeto. */
export const PedidoDeMudarLista = Type.Object({ listaId: Id }, { additionalProperties: false });
export type PedidoDeMudarLista = Static<typeof PedidoDeMudarLista>;

/** Ações de auditoria das listas e dos status do projeto (M3-02). Nos detalhes vão ids, nunca nomes. */
export const ACOES_LISTAS = ["lista.criou", "lista.editou", "lista.excluiu", "status.editou"] as const;
