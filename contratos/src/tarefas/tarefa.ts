/**
 * Tarefa (M2-01): o trabalho que uma pessoa ou um agente faz, com status, responsável, comentários e o
 * resultado entregue ao concluir.
 *
 * O formato já traz a trava (M2-02): quem pegou a tarefa e desde quando. Assim os contratos de tarefa
 * passam por uma aprovação só. Espaços, projetos, listas, prazos e etiquetas vêm no M3.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/** Status fixos no M2 (decisão do Sandro em 18/11/2026). Status por projeto vem no M3. */
export const STATUS_TAREFA = [
  "a_fazer",
  "em_andamento",
  "precisa_de_ajuda",
  "concluida",
  "cancelada",
] as const;
export const StatusTarefa = Type.Enum(STATUS_TAREFA, {
  description:
    "a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Concluída e cancelada encerram a tarefa.",
});
export type StatusTarefa = Static<typeof StatusTarefa>;

/** Nome de cada status como aparece nas telas. */
export const NOMES_STATUS_TAREFA: Record<StatusTarefa, string> = {
  a_fazer: "A fazer",
  em_andamento: "Em andamento",
  precisa_de_ajuda: "Precisa de ajuda",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/** Status que encerram a tarefa: nela não há trava, e só sai daqui reabrindo (volta para A fazer). */
export const STATUS_ENCERRADOS: readonly StatusTarefa[] = ["concluida", "cancelada"];

/** Quem cuida da tarefa: uma pessoa da empresa ou um agente da empresa (o agente vale a partir da M2-03). */
export const Responsavel = Type.Union(
  [
    Type.Object({ tipo: Type.Literal("pessoa"), pessoaId: Id }, { additionalProperties: false }),
    Type.Object({ tipo: Type.Literal("agente"), agenteId: Id }, { additionalProperties: false }),
  ],
  { description: "Pessoa ou agente da mesma empresa." },
);
export type Responsavel = Static<typeof Responsavel>;

/**
 * Quem escreveu algo na tarefa (criou, comentou, entregou o resultado). O sistema também comenta, por
 * exemplo quando a tarefa volta para A fazer porque o agente ficou sem sinal (M2-04).
 * O texto que vem de agente é mostrado sempre como texto, nunca como código (M2-05).
 */
export const Autor = Type.Union(
  [
    Type.Object({ tipo: Type.Literal("pessoa"), pessoaId: Id }, { additionalProperties: false }),
    Type.Object({ tipo: Type.Literal("agente"), agenteId: Id }, { additionalProperties: false }),
    Type.Object({ tipo: Type.Literal("sistema") }, { additionalProperties: false }),
  ],
  { description: "Pessoa, agente ou o próprio sistema." },
);
export type Autor = Static<typeof Autor>;

/** A trava (M2-02): quem pegou a tarefa e desde quando. Só quem pegou muda o status e entrega. */
export const Trava = Type.Object(
  { por: Responsavel, desde: DataHora },
  { additionalProperties: false, description: "Quem pegou a tarefa e desde quando." },
);
export type Trava = Static<typeof Trava>;

const Titulo = Texto(200, "O que precisa ser feito, numa linha.");
const Descricao = Texto(20000, "Detalhes, contexto e o que se espera.");
const TextoDoResultado = Texto(50000, "O que o responsável entrega ao concluir.");

export const Tarefa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    titulo: Titulo,
    descricao: OuNulo(Descricao),
    status: StatusTarefa,
    responsavel: OuNulo(Responsavel),
    criadaPor: Autor,
    trava: OuNulo(Trava),
    resultado: OuNulo(TextoDoResultado),
    resultadoPor: OuNulo(Autor),
    criadaEm: DataHora,
    atualizadaEm: DataHora,
    encerradaEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Tarefa de uma empresa." },
);
export type Tarefa = Static<typeof Tarefa>;

export const regrasDaTarefa: Regra<Tarefa>[] = [
  (t) => {
    const problemas: Problema[] = [];
    const encerrada = STATUS_ENCERRADOS.includes(t.status);
    if (encerrada && t.encerradaEm === null) {
      problemas.push({ caminho: "/encerradaEm", mensagem: "tarefa encerrada precisa da data" });
    }
    if (!encerrada && t.encerradaEm !== null) {
      problemas.push({
        caminho: "/encerradaEm",
        mensagem: "só tarefa concluída ou cancelada tem data de encerramento",
      });
    }
    if (encerrada && t.trava !== null) {
      problemas.push({ caminho: "/trava", mensagem: "tarefa encerrada não fica travada" });
    }
    if (t.status === "a_fazer" && t.trava !== null) {
      problemas.push({ caminho: "/trava", mensagem: "tarefa travada está em andamento, não a fazer" });
    }
    return problemas;
  },
  (t) => {
    if ((t.resultado === null) !== (t.resultadoPor === null)) {
      return [{ caminho: "/resultadoPor", mensagem: "o resultado sempre diz quem entregou" }];
    }
    if (t.resultado !== null && t.status !== "concluida") {
      return [{ caminho: "/resultado", mensagem: "só tarefa concluída tem resultado" }];
    }
    return [];
  },
  (t) =>
    t.resultadoPor?.tipo === "sistema"
      ? [{ caminho: "/resultadoPor", mensagem: "o sistema não entrega resultado" }]
      : [],
];

export function conferirTarefa(valor: unknown) {
  return conferir(Tarefa, valor, regrasDaTarefa);
}

export const ComentarioDeTarefa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tarefaId: Id,
    autor: Autor,
    texto: Texto(10000, "O comentário, em texto simples."),
    criadoEm: DataHora,
  },
  { additionalProperties: false, description: "Comentário numa tarefa. Não se edita nem se apaga no M2." },
);
export type ComentarioDeTarefa = Static<typeof ComentarioDeTarefa>;

export function conferirComentarioDeTarefa(valor: unknown) {
  return conferir(ComentarioDeTarefa, valor);
}

/** O que a API recebe para criar uma tarefa. Sem responsável, a tarefa fica com quem criou. */
export const PedidoDeTarefa = Type.Object(
  {
    titulo: Titulo,
    descricao: Type.Optional(OuNulo(Descricao)),
    responsavel: Type.Optional(OuNulo(Responsavel)),
  },
  { additionalProperties: false },
);
export type PedidoDeTarefa = Static<typeof PedidoDeTarefa>;

/** Mudar o status. Concluir pode trazer o resultado; cancelar e reabrir, um motivo que vira comentário. */
export const PedidoDeMudarStatus = Type.Object(
  {
    status: StatusTarefa,
    resultado: Type.Optional(TextoDoResultado),
    motivo: Type.Optional(Texto(1000, "Por que mudou (vira comentário).")),
  },
  { additionalProperties: false },
);
export type PedidoDeMudarStatus = Static<typeof PedidoDeMudarStatus>;

export function conferirPedidoDeMudarStatus(valor: unknown) {
  return conferir(PedidoDeMudarStatus, valor, [
    (p): Problema[] =>
      p.resultado !== undefined && p.status !== "concluida"
        ? [{ caminho: "/resultado", mensagem: "resultado só ao concluir" }]
        : [],
  ]);
}

export const PedidoDeTrocarResponsavel = Type.Object(
  { responsavel: OuNulo(Responsavel) },
  { additionalProperties: false },
);
export type PedidoDeTrocarResponsavel = Static<typeof PedidoDeTrocarResponsavel>;

export const PedidoDeComentario = Type.Object(
  { texto: Texto(10000, "O comentário, em texto simples.") },
  { additionalProperties: false },
);
export type PedidoDeComentario = Static<typeof PedidoDeComentario>;

/** Filtro da lista: "minhas" (sou o responsável ou criei) e por status. */
export const FiltroDeTarefas = Type.Object(
  {
    minhas: Type.Optional(Type.Boolean()),
    status: Type.Optional(Type.Array(StatusTarefa, { minItems: 1, uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type FiltroDeTarefas = Static<typeof FiltroDeTarefas>;

/** Destravar (só o administrador, M2-02): o motivo é obrigatório e vai para a auditoria. */
export const PedidoDeDestravar = Type.Object(
  { motivo: Texto(1000, "Por que destravou.") },
  { additionalProperties: false },
);
export type PedidoDeDestravar = Static<typeof PedidoDeDestravar>;

/** Ações de auditoria das tarefas (M2-01 e M2-02). Nos detalhes vão ids e status, nunca o texto. */
export const ACOES_TAREFAS = [
  "tarefa.criou",
  "tarefa.mudou_status",
  "tarefa.trocou_responsavel",
  "tarefa.comentou",
  "tarefa.pegou",
  "tarefa.soltou",
  "tarefa.destravou",
] as const;
