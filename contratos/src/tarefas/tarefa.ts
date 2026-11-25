/**
 * Tarefa (M2-01): o trabalho que uma pessoa ou um agente faz, com status, responsável, comentários e o
 * resultado entregue ao concluir.
 *
 * O formato já traz a trava (M2-02): quem pegou a tarefa e desde quando. Assim os contratos de tarefa
 * passam por uma aprovação só. O projeto entrou na M3-01; listas, prazos e etiquetas vêm na M3-02 e na M3-03.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Dia, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";
import { PedidoDePrazo, Prazo, Prioridade, RegraDeRecorrencia } from "./prazos.ts";

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
    /** Projeto da tarefa (M3-01). Nulo: "Sem projeto" (decisão do Sandro em 19/11/2026). */
    projetoId: OuNulo(Id),
    /** Lista do projeto (M3-02). Tarefa de projeto sempre tem lista; sem projeto, nulo. */
    listaId: OuNulo(Id),
    /** Status do projeto (M3-02), sempre do mesmo tipo de "status". Sem projeto, nulo. */
    statusDoProjetoId: OuNulo(Id),
    /** Tarefa-mãe, quando esta é uma subtarefa (M3-02, um nível só). */
    tarefaMaeId: OuNulo(Id),
    /** Prioridade (M3-03). Nulo: sem prioridade. */
    prioridade: OuNulo(Prioridade),
    /** Prazo (M3-03): dia, hora opcional e fuso. */
    prazo: OuNulo(Prazo),
    /** Dia de início, para o calendário (M3-03). */
    inicio: OuNulo(Dia),
    /** Etiquetas da empresa marcadas na tarefa (M3-03). */
    etiquetas: Type.Array(Id, { maxItems: 20 }),
    /** Como a tarefa se repete (M3-03). Precisa de prazo. */
    recorrencia: OuNulo(RegraDeRecorrencia),
    /** Quantas vezes a tarefa já aconteceu, contando esta (1 na primeira). */
    ocorrencia: Type.Integer({ minimum: 1 }),
    /** A tarefa anterior da recorrência, que ao ser concluída criou esta. */
    recorrenteDeId: OuNulo(Id),
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
  (t) => {
    const semProjeto = t.projetoId === null;
    if (semProjeto !== (t.listaId === null) || semProjeto !== (t.statusDoProjetoId === null)) {
      return [
        {
          caminho: "/listaId",
          mensagem: "tarefa de projeto tem lista e status do projeto; sem projeto, não",
        },
      ];
    }
    return t.tarefaMaeId === t.id
      ? [{ caminho: "/tarefaMaeId", mensagem: "a tarefa não é mãe dela mesma" }]
      : [];
  },
  (t) => {
    const problemas: Problema[] = [];
    if (t.recorrencia !== null && t.prazo === null) {
      problemas.push({ caminho: "/recorrencia", mensagem: "tarefa recorrente precisa de prazo" });
    }
    if (t.inicio !== null && t.prazo !== null && t.inicio > t.prazo.dia) {
      problemas.push({ caminho: "/inicio", mensagem: "o início vem antes do prazo" });
    }
    return problemas;
  },
];

export function conferirTarefa(valor: unknown) {
  return conferir(Tarefa, valor, regrasDaTarefa);
}

/**
 * Comentário ou nota interna (M3-05). Nota interna (decisão 10 do Sandro, 19/11/2026): só as pessoas da empresa
 * veem; não vai para os agentes pelo MCP nem, no futuro, para o cliente no portal.
 */
export const TIPOS_DE_COMENTARIO = ["comentario", "nota_interna"] as const;
export const TipoDeComentario = Type.Enum(TIPOS_DE_COMENTARIO, {
  description: "comentario ou nota_interna.",
});
export type TipoDeComentario = Static<typeof TipoDeComentario>;

/** Texto do comentário em Markdown simples (negrito, lista, link, código), mostrado com limpeza, nunca como HTML. */
const TextoDoComentario = Texto(10000, "O comentário, em Markdown simples.");

export const ComentarioDeTarefa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tarefaId: Id,
    autor: Autor,
    tipo: TipoDeComentario,
    /** Nulo quando o comentário foi apagado (fica "comentário apagado" no lugar). */
    texto: OuNulo(TextoDoComentario),
    /** Pessoas e agentes mencionados com @ (M3-05). */
    mencoes: Type.Array(Responsavel, { maxItems: 50 }),
    criadoEm: DataHora,
    editadoEm: OuNulo(DataHora),
    apagadoEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Comentário ou nota interna numa tarefa." },
);
export type ComentarioDeTarefa = Static<typeof ComentarioDeTarefa>;

export function conferirComentarioDeTarefa(valor: unknown) {
  return conferir(ComentarioDeTarefa, valor, [
    (c) =>
      (c.texto === null) !== (c.apagadoEm !== null)
        ? [{ caminho: "/texto", mensagem: "comentário apagado não tem texto; com texto, não está apagado" }]
        : [],
  ]);
}

/** O que a API recebe para criar uma tarefa. Sem responsável, a tarefa fica com quem criou. */
export const PedidoDeTarefa = Type.Object(
  {
    titulo: Titulo,
    descricao: Type.Optional(OuNulo(Descricao)),
    responsavel: Type.Optional(OuNulo(Responsavel)),
    projetoId: Type.Optional(OuNulo(Id)),
    /** Lista do projeto (M3-02). Sem lista, vai para a primeira. */
    listaId: Type.Optional(Id),
    /** Cria como subtarefa desta tarefa (M3-02): fica no projeto e na lista dela. */
    tarefaMaeId: Type.Optional(Id),
    prioridade: Type.Optional(OuNulo(Prioridade)),
    prazo: Type.Optional(OuNulo(PedidoDePrazo)),
    inicio: Type.Optional(OuNulo(Dia)),
    etiquetas: Type.Optional(Type.Array(Id, { maxItems: 20, uniqueItems: true })),
    recorrencia: Type.Optional(OuNulo(RegraDeRecorrencia)),
  },
  { additionalProperties: false },
);
export type PedidoDeTarefa = Static<typeof PedidoDeTarefa>;

/** Mudar o status. Concluir pode trazer o resultado; cancelar e reabrir, um motivo que vira comentário. */
export const PedidoDeMudarStatus = Type.Object(
  {
    status: StatusTarefa,
    /** Status do projeto (M3-02), do mesmo tipo de "status". Sem ele, vai para o primeiro status do tipo. */
    statusId: Type.Optional(Id),
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
  {
    texto: TextoDoComentario,
    /** Nota interna: só as pessoas da empresa veem (M3-05). */
    interna: Type.Optional(Type.Boolean()),
    /** Quem foi mencionado com @ (a tela manda; o servidor confere que vê a tarefa). */
    mencoes: Type.Optional(Type.Array(Responsavel, { maxItems: 50 })),
  },
  { additionalProperties: false },
);
export type PedidoDeComentario = Static<typeof PedidoDeComentario>;

/** Editar o texto (quem escreveu, em até 15 minutos). */
export const PedidoDeEditarComentario = Type.Object(
  { texto: TextoDoComentario },
  { additionalProperties: false },
);
export type PedidoDeEditarComentario = Static<typeof PedidoDeEditarComentario>;

/** O que aconteceu na tarefa, para a linha do tempo (M3-05). Detalhes só com ids e valores fixos, nunca texto livre. */
export const TIPOS_DE_ACONTECIMENTO = [
  "criou",
  "mudou_status",
  "trocou_responsavel",
  "mudou_prazo",
  "mudou_prioridade",
  "mudou_projeto",
  "mudou_lista",
  "entregou_resultado",
  "pegou",
  "soltou",
] as const;
export const TipoDeAcontecimento = Type.Enum(TIPOS_DE_ACONTECIMENTO);
export type TipoDeAcontecimento = Static<typeof TipoDeAcontecimento>;

export const AcontecimentoDaTarefa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tarefaId: Id,
    autor: Autor,
    tipo: TipoDeAcontecimento,
    detalhes: Type.Record(Type.String(), Type.Unknown()),
    criadoEm: DataHora,
  },
  { additionalProperties: false, description: "Algo que aconteceu na tarefa, na linha do tempo." },
);
export type AcontecimentoDaTarefa = Static<typeof AcontecimentoDaTarefa>;

/** Filtro da lista: "minhas" (sou o responsável ou criei) e por status. */
export const FiltroDeTarefas = Type.Object(
  {
    minhas: Type.Optional(Type.Boolean()),
    status: Type.Optional(Type.Array(StatusTarefa, { minItems: 1, uniqueItems: true })),
    /** Um projeto, ou "sem" para as tarefas sem projeto (M3-01). */
    projetoId: Type.Optional(Type.Union([Id, Type.Literal("sem")])),
    /** Todos os projetos de um espaço (M3-04). */
    espacoId: Type.Optional(Id),
    /** Responsáveis (pessoas ou agentes) (M3-04). */
    responsaveis: Type.Optional(Type.Array(Responsavel, { minItems: 1, maxItems: 50 })),
    /** Só as que estão com algum agente, responsável ou com a trava: "o que roda num agente" (M3-04). */
    deAgente: Type.Optional(Type.Boolean()),
    /** Prioridades; "sem" para as sem prioridade (M3-04). */
    prioridades: Type.Optional(
      Type.Array(Type.Union([Prioridade, Type.Literal("sem")]), { minItems: 1, uniqueItems: true }),
    ),
    /** Tem pelo menos uma destas etiquetas (M3-04). */
    etiquetas: Type.Optional(Type.Array(Id, { minItems: 1, maxItems: 20, uniqueItems: true })),
    /** Atalhos de prazo, no fuso de quem pede: atrasadas, vencendo hoje, nos próximos 7 dias ou sem prazo (M3-04). */
    prazo: Type.Optional(Type.Enum(["atrasadas", "hoje", "semana", "sem_prazo"] as const)),
    /** O dia do prazo (no fuso de quem pede) dentro destes dias, para o calendário (M3-04). */
    de: Type.Optional(Dia),
    ate: Type.Optional(Dia),
    /** Só as tarefas ligadas a este contato (M7-01, a ficha do contato). */
    contatoId: Type.Optional(Id),
    /** Inclui as subtarefas na lista (padrão: sim). */
    subtarefas: Type.Optional(Type.Boolean()),
    /** Texto livre: no título, na descrição ou nos comentários, sem acento e aceitando erro de digitação. */
    texto: Type.Optional(Type.String({ minLength: 2, maxLength: 200 })),
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
/** Ações de auditoria da linha do tempo (M3-05). */
export const ACOES_LINHA_DO_TEMPO = [
  "tarefa.editou_comentario",
  "tarefa.apagou_comentario",
  "tarefa.mencionou",
] as const;

export const ACOES_TAREFAS = [
  "tarefa.criou",
  "tarefa.mudou_status",
  "tarefa.trocou_responsavel",
  "tarefa.comentou",
  "tarefa.excluiu",
  "tarefa.pegou",
  "tarefa.soltou",
  "tarefa.destravou",
] as const;
