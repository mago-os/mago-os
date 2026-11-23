/**
 * Rotinas por horário (M5-05, decisão 0039).
 *
 * Uma rotina é "quando chegar a hora, faça isto em meu nome": tem nome, gatilho, ação, dono e situação. O dono é quem
 * criou, e a rotina age com a permissão dele no momento em que roda (a menor das duas, quando a ação chama um agente,
 * como na M4-04). Decisões do Sandro na spec do M5 (22/11/2026):
 * 9. Horários: as mesmas repetições da recorrência das tarefas, com hora e fuso, sem "a cada X minutos"; até 24
 *    horários por dia. Pular feriados fica para a Fase 2.
 * 10. Três ações na Fase 1: criar tarefa, pedir a um agente interno e mandar aviso. A rotina nasce desligada e tem
 *    "Rodar agora", que roda uma vez de verdade.
 * 11. Módulo de permissão "rotinas": o administrador vê todas; gestor e funcionário criam as próprias, e o gestor vê
 *    as da equipe.
 *
 * M5-06 (decisão 0040): o gatilho por evento do sistema (tarefa criada, concluída, mudou de status, atrasada, precisa
 * de ajuda, comentário, aprovação pedida), com filtros simples; a ação recebe a tarefa que disparou.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Dia, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { FusoHorario } from "../identidade/pessoa.ts";
import { Hora, Prioridade, RegraDeRecorrencia } from "../tarefas/prazos.ts";
import { Responsavel, StatusTarefa } from "../tarefas/tarefa.ts";

/** No máximo 24 execuções por dia em cada rotina, contando o "Rodar agora" (no fuso da rotina). */
export const MAXIMO_DE_EXECUCOES_POR_DIA = 24;
/** Horários marcados num dia (o mesmo limite de execuções por dia). */
export const MAXIMO_DE_HORARIOS = 24;
/** Uma pessoa tem até 50 rotinas na empresa (ligadas ou não). */
export const MAXIMO_DE_ROTINAS_POR_PESSOA = 50;
/** Falha tenta de novo duas vezes: 5 e 15 minutos depois. Depois disso, vai para a central de prioridades do dono. */
export const MINUTOS_PARA_TENTAR_DE_NOVO = [5, 15] as const;
/** Quantas pessoas um aviso de rotina alcança. */
export const MAXIMO_DE_PESSOAS_NO_AVISO = 50;
/** Uma rotina por evento dispara no máximo 3 vezes por minuto (decisão 13), além das 24 por dia. */
export const MAXIMO_DE_DISPAROS_POR_MINUTO = 3;
/**
 * Nos textos de uma rotina por evento (título e descrição da tarefa, pedido ao agente, aviso), este marcador vira o
 * título da tarefa que disparou. O pedido ao agente leva também o id dela, para ele abrir.
 */
export const MARCADOR_DA_TAREFA = "{tarefa}";

// Gatilho

/**
 * Gatilho por horário. A regra é a mesma da recorrência das tarefas (todo dia, a cada N dias, dias da semana,
 * todo mês num dia, todo ano), contada a partir do dia de início, com um ou mais horários no dia, no fuso escolhido
 * (com o horário de verão de cada lugar). Para numa data (regra.ate) ou depois de tantas execuções (regra.vezes),
 * o que vier primeiro. Sem dias da semana na semanal, vale o dia da semana do início; sem dia do mês na mensal, o dia
 * do início.
 */
export const GatilhoPorHorario = Type.Object(
  {
    tipo: Type.Literal("horario"),
    regra: RegraDeRecorrencia,
    horas: Type.Array(Hora, { minItems: 1, maxItems: MAXIMO_DE_HORARIOS, uniqueItems: true }),
    fuso: FusoHorario,
    inicio: Dia,
  },
  { additionalProperties: false, description: "Quando a rotina roda: dias, horários e fuso." },
);
export type GatilhoPorHorario = Static<typeof GatilhoPorHorario>;

/** Os eventos do sistema que disparam rotinas na Fase 1 (decisão 12). */
export const EVENTOS_DE_ROTINA = [
  "tarefa_criada",
  "tarefa_concluida",
  "tarefa_mudou_status",
  "tarefa_atrasada",
  "tarefa_precisa_de_ajuda",
  "comentario",
  "aprovacao_pedida",
] as const;
export const EventoDeRotina = Type.Enum(EVENTOS_DE_ROTINA);
export type EventoDeRotina = Static<typeof EventoDeRotina>;

export const NOMES_DOS_EVENTOS: Record<EventoDeRotina, string> = {
  tarefa_criada: "Tarefa criada",
  tarefa_concluida: "Tarefa concluída",
  tarefa_mudou_status: "Tarefa mudou de status",
  tarefa_atrasada: "Tarefa atrasada (o prazo passou)",
  tarefa_precisa_de_ajuda: "Tarefa precisa de ajuda",
  comentario: "Comentário numa tarefa",
  aprovacao_pedida: "Um agente pediu aprovação",
};

/**
 * Filtros simples sobre a tarefa do evento: todos os informados precisam bater (sem condições livres na Fase 1).
 * "status" é o status da tarefa depois do evento (útil em "mudou de status").
 */
export const FiltrosDoEvento = Type.Object(
  {
    projetoId: Type.Optional(Id),
    listaId: Type.Optional(Id),
    etiquetaId: Type.Optional(Id),
    prioridade: Type.Optional(Prioridade),
    responsavel: Type.Optional(Responsavel),
    status: Type.Optional(StatusTarefa),
  },
  { additionalProperties: false },
);
export type FiltrosDoEvento = Static<typeof FiltrosDoEvento>;

/** Gatilho por evento do sistema (M5-06): roda quando o evento acontece numa tarefa que o dono vê. */
export const GatilhoPorEvento = Type.Object(
  {
    tipo: Type.Literal("evento"),
    evento: EventoDeRotina,
    filtros: FiltrosDoEvento,
  },
  { additionalProperties: false, description: "Quando a rotina roda: um evento do sistema, com filtros." },
);
export type GatilhoPorEvento = Static<typeof GatilhoPorEvento>;

export const GatilhoDaRotina = Type.Union([GatilhoPorHorario, GatilhoPorEvento]);
export type GatilhoDaRotina = Static<typeof GatilhoDaRotina>;

// Ações (decisão 10)

/** Prazo relativo da tarefa criada: "em 2 dias", com hora opcional, no fuso do gatilho. */
export const PrazoRelativo = Type.Object(
  {
    emDias: Type.Integer({
      minimum: 0,
      maximum: 365,
      description: "Quantos dias depois do dia em que rodou.",
    }),
    hora: Type.Optional(OuNulo(Hora)),
  },
  { additionalProperties: false },
);
export type PrazoRelativo = Static<typeof PrazoRelativo>;

/**
 * Criar uma tarefa, como o dono criaria pela tela (com a permissão dele). Sem responsável, fica com o dono. Um
 * agente interno como responsável começa a trabalhar em nome do dono (M4-04).
 */
export const AcaoCriarTarefa = Type.Object(
  {
    tipo: Type.Literal("criar_tarefa"),
    titulo: Texto(200, "O título da tarefa criada."),
    descricao: Type.Optional(OuNulo(Texto(20000, "A descrição da tarefa criada."))),
    responsavel: Type.Optional(OuNulo(Responsavel)),
    projetoId: Type.Optional(OuNulo(Id)),
    prioridade: Type.Optional(OuNulo(Prioridade)),
    prazo: Type.Optional(OuNulo(PrazoRelativo)),
    /** Só na rotina por evento: a tarefa nasce como subtarefa da que disparou (se ela não for subtarefa). */
    comoSubtarefa: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, description: "Cria uma tarefa." },
);
export type AcaoCriarTarefa = Static<typeof AcaoCriarTarefa>;

export const RESULTADOS_DO_PEDIDO = ["mensagem", "tarefa"] as const;
export const ResultadoDoPedido = Type.Enum(RESULTADOS_DO_PEDIDO, {
  description:
    "mensagem: a resposta chega numa conversa do dono, no app e no Telegram. tarefa: vira uma tarefa do agente, com o resultado nela.",
});
export type ResultadoDoPedido = Static<typeof ResultadoDoPedido>;

/**
 * Pedir a um agente interno, com as palavras do dono. O dono só escolhe um agente com quem poderia conversar
 * (o coordenador, ou um especialista se ele pode falar direto com especialistas). A skill, se houver, precisa ser
 * uma das skills do agente ("plataforma:<nome>" ou o id de uma skill da empresa).
 */
export const AcaoPedirAoAgente = Type.Object(
  {
    tipo: Type.Literal("pedir_ao_agente"),
    agenteId: Id,
    pedido: Texto(4000, "O que pedir ao agente, como numa conversa."),
    skill: Type.Optional(OuNulo(Texto(80, "A skill que o agente deve usar."))),
    resultado: ResultadoDoPedido,
  },
  { additionalProperties: false, description: "Pede um trabalho a um agente interno." },
);
export type AcaoPedirAoAgente = Static<typeof AcaoPedirAoAgente>;

/**
 * Mandar um aviso (no sino, no push e, por padrão, no Telegram) a pessoas da empresa que o dono pode ver em Pessoas:
 * o funcionário avisa só a si mesmo, o gestor a equipe, o administrador qualquer pessoa.
 */
export const AcaoMandarAviso = Type.Object(
  {
    tipo: Type.Literal("mandar_aviso"),
    para: Type.Array(Id, { minItems: 1, maxItems: MAXIMO_DE_PESSOAS_NO_AVISO, uniqueItems: true }),
    texto: Texto(300, "O aviso, numa ou duas frases."),
    link: Type.Optional(
      OuNulo(
        Type.String({
          pattern: "^/[a-z0-9/_-]*$",
          maxLength: 200,
          description: "Tela do Mago OS a abrir (ex.: /tarefas).",
        }),
      ),
    ),
  },
  { additionalProperties: false, description: "Manda um aviso a pessoas da empresa." },
);
export type AcaoMandarAviso = Static<typeof AcaoMandarAviso>;

export const AcaoDaRotina = Type.Union([AcaoCriarTarefa, AcaoPedirAoAgente, AcaoMandarAviso], {
  description: "O que a rotina faz: criar tarefa, pedir a um agente interno ou mandar aviso.",
});
export type AcaoDaRotina = Static<typeof AcaoDaRotina>;

export const TIPOS_DE_ACAO_DA_ROTINA = ["criar_tarefa", "pedir_ao_agente", "mandar_aviso"] as const;

// Rotina

export const SITUACOES_DA_ROTINA = ["ligada", "desligada"] as const;
export const SituacaoDaRotina = Type.Enum(SITUACOES_DA_ROTINA);
export type SituacaoDaRotina = Static<typeof SituacaoDaRotina>;

/**
 * Por que a rotina foi desligada. pessoa: alguém desligou na tela (ou ela nasceu assim); terminou: chegou na data
 * final ou no número de vezes; dono_desligado: o dono saiu da empresa (o administrador é avisado); agente: um agente
 * parou a rotina pela ferramenta.
 */
export const MOTIVOS_DE_DESLIGAR = ["pessoa", "terminou", "dono_desligado", "agente"] as const;
export const MotivoDeDesligar = Type.Enum(MOTIVOS_DE_DESLIGAR);
export type MotivoDeDesligar = Static<typeof MotivoDeDesligar>;

const NomeDaRotina = Texto(120, "Nome da rotina (ex.: Resumo das atrasadas na segunda).");

export const Rotina = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: NomeDaRotina,
    /** Quem criou: a rotina age em nome dele e só ele a faz agir (ligar, Rodar agora, editar). */
    donoPessoaId: Id,
    /** O agente que criou a rotina pela ferramenta (a pedido do dono e com a aprovação dele), se foi assim. */
    criadaPorAgenteId: OuNulo(Id),
    gatilho: GatilhoDaRotina,
    acao: AcaoDaRotina,
    situacao: SituacaoDaRotina,
    /** Só na desligada. */
    desligadaPorque: OuNulo(MotivoDeDesligar),
    /** Teto de gasto do mês só desta rotina, em centavos de dólar (como os tetos da M4-06). Nulo: sem teto próprio. */
    tetoMensal: OuNulo(Type.Integer({ minimum: 1, maximum: 10_000_000 })),
    /** A próxima vez que roda (só na ligada). */
    proximaEm: OuNulo(DataHora),
    /** Quantas vezes já rodou pelo horário (para regra.vezes). */
    vezes: Type.Integer({ minimum: 0 }),
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Rotina: o que roda sozinho, no horário, em nome do dono." },
);
export type Rotina = Static<typeof Rotina>;

export function conferirRotina(valor: unknown) {
  return conferir(Rotina, valor, [
    (r): Problema[] => {
      const problemas: Problema[] = [];
      if ((r.situacao === "desligada") !== (r.desligadaPorque !== null))
        problemas.push({ caminho: "/desligadaPorque", mensagem: "só a rotina desligada diz por quê" });
      if ((r.situacao === "desligada" || r.gatilho.tipo === "evento") && r.proximaEm !== null)
        problemas.push({ caminho: "/proximaEm", mensagem: "só a rotina por horário ligada tem próxima vez" });
      return problemas;
    },
    (r) => problemasDoGatilho(r.gatilho, "/gatilho"),
    (r) => problemasDaAcao(r.gatilho, r.acao),
  ]);
}

/** Subtarefa da que disparou só faz sentido numa rotina por evento. */
function problemasDaAcao(g: GatilhoDaRotina, a: AcaoDaRotina): Problema[] {
  if (a.tipo === "criar_tarefa" && a.comoSubtarefa && g.tipo !== "evento")
    return [
      { caminho: "/acao/comoSubtarefa", mensagem: "subtarefa da que disparou só na rotina por evento" },
    ];
  return [];
}

function problemasDoGatilho(g: GatilhoDaRotina, caminho: string): Problema[] {
  if (g.tipo === "evento") return [];
  const problemas: Problema[] = [];
  if (g.regra.diasDaSemana && g.regra.frequencia !== "semanal")
    problemas.push({
      caminho: `${caminho}/regra/diasDaSemana`,
      mensagem: "dias da semana só na repetição semanal",
    });
  if (g.regra.diaDoMes !== undefined && g.regra.frequencia !== "mensal")
    problemas.push({ caminho: `${caminho}/regra/diaDoMes`, mensagem: "dia do mês só na repetição mensal" });
  if (g.regra.ate && g.regra.ate < g.inicio)
    problemas.push({ caminho: `${caminho}/regra/ate`, mensagem: "a data final vem depois do início" });
  return problemas;
}

/** Criar uma rotina. Ela nasce desligada (decisão 10). */
export const PedidoDeRotina = Type.Object(
  {
    nome: NomeDaRotina,
    gatilho: GatilhoDaRotina,
    acao: AcaoDaRotina,
    tetoMensal: Type.Optional(OuNulo(Type.Integer({ minimum: 1, maximum: 10_000_000 }))),
  },
  { additionalProperties: false },
);
export type PedidoDeRotina = Static<typeof PedidoDeRotina>;

export function conferirPedidoDeRotina(valor: unknown) {
  return conferir(PedidoDeRotina, valor, [
    (r) => problemasDoGatilho(r.gatilho, "/gatilho"),
    (r) => problemasDaAcao(r.gatilho, r.acao),
  ]);
}

/** Editar (só o dono). Só o que veio muda; editar não liga nem desliga. */
export const PedidoDeEdicaoDeRotina = Type.Object(
  {
    nome: Type.Optional(NomeDaRotina),
    gatilho: Type.Optional(GatilhoDaRotina),
    acao: Type.Optional(AcaoDaRotina),
    tetoMensal: Type.Optional(OuNulo(Type.Integer({ minimum: 1, maximum: 10_000_000 }))),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEdicaoDeRotina = Static<typeof PedidoDeEdicaoDeRotina>;

export function conferirPedidoDeEdicaoDeRotina(valor: unknown) {
  return conferir(PedidoDeEdicaoDeRotina, valor, [
    (r) => (r.gatilho ? problemasDoGatilho(r.gatilho, "/gatilho") : []),
  ]);
}

// Execuções

export const ORIGENS_DA_EXECUCAO_DE_ROTINA = ["horario", "evento", "rodar_agora"] as const;
export const OrigemDaExecucaoDeRotina = Type.Enum(ORIGENS_DA_EXECUCAO_DE_ROTINA);
export type OrigemDaExecucaoDeRotina = Static<typeof OrigemDaExecucaoDeRotina>;

/**
 * na_fila → rodando → feita ou falhou. esperando: a ação chama um agente e os agentes estão parados (M4-09), ou a
 * falha espera a próxima tentativa. pulada: não rodou (passou do limite do dia ou do teto do mês, ou outra execução
 * da mesma rotina já esperava), com o motivo.
 */
export const SITUACOES_DA_EXECUCAO_DE_ROTINA = [
  "na_fila",
  "rodando",
  "esperando",
  "feita",
  "falhou",
  "pulada",
] as const;
export const SituacaoDaExecucaoDeRotina = Type.Enum(SITUACOES_DA_EXECUCAO_DE_ROTINA);
export type SituacaoDaExecucaoDeRotina = Static<typeof SituacaoDaExecucaoDeRotina>;

export const ExecucaoDeRotina = Type.Object(
  {
    id: Id,
    empresaId: Id,
    rotinaId: Id,
    origem: OrigemDaExecucaoDeRotina,
    /** O horário marcado (no "Rodar agora", nulo). */
    previstaPara: OuNulo(DataHora),
    /** A tarefa que disparou (rotina por evento, ou a escolhida para o "Rodar agora" dela). */
    tarefaDoEventoId: OuNulo(Id),
    /** O evento que disparou (só pela origem "evento"). */
    evento: OuNulo(EventoDeRotina),
    situacao: SituacaoDaExecucaoDeRotina,
    /** 1, 2 ou 3 (as duas novas tentativas depois de uma falha). */
    tentativa: Type.Integer({ minimum: 1, maximum: 1 + MINUTOS_PARA_TENTAR_DE_NOVO.length }),
    proximaTentativaEm: OuNulo(DataHora),
    /** Por que falhou ou foi pulada, em texto curto (sem dado sensível). */
    motivo: OuNulo(Texto(500, "Por que falhou ou foi pulada.")),
    /** O que a execução fez: a tarefa criada, a execução do agente (para o passo a passo), a conversa, os avisados. */
    tarefaId: OuNulo(Id),
    execucaoDeAgenteId: OuNulo(Id),
    conversaId: OuNulo(Id),
    avisados: Type.Integer({ minimum: 0 }),
    /** O custo da IA desta execução, em centavos de dólar (só quando chama agente). */
    custo: Type.Number({ minimum: 0 }),
    criadaEm: DataHora,
    iniciadaEm: OuNulo(DataHora),
    terminadaEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Uma vez que a rotina rodou (ou tentou)." },
);
export type ExecucaoDeRotina = Static<typeof ExecucaoDeRotina>;

export function conferirExecucaoDeRotina(valor: unknown) {
  return conferir(ExecucaoDeRotina, valor, [
    (e): Problema[] => {
      const terminou = e.situacao === "feita" || e.situacao === "falhou" || e.situacao === "pulada";
      if (terminou !== (e.terminadaEm !== null))
        return [{ caminho: "/terminadaEm", mensagem: "só a execução terminada tem a hora do fim" }];
      if ((e.origem === "horario") !== (e.previstaPara !== null))
        return [{ caminho: "/previstaPara", mensagem: "só a execução pelo horário tem a hora marcada" }];
      if (
        (e.origem === "evento") !== (e.evento !== null) ||
        (e.origem === "evento" && e.tarefaDoEventoId === null)
      )
        return [{ caminho: "/evento", mensagem: "a execução por evento diz o evento e a tarefa" }];
      return [];
    },
  ]);
}

/**
 * "Rodar agora" (só o dono). Na rotina por evento, a tarefa com que testar (uma que o dono vê); sem ela, a mais
 * recente que ele vê e que passa nos filtros.
 */
export const PedidoParaRodarAgora = Type.Object(
  { tarefaId: Type.Optional(Id) },
  { additionalProperties: false },
);
export type PedidoParaRodarAgora = Static<typeof PedidoParaRodarAgora>;

/** Ações de auditoria das rotinas. Nos detalhes vão ids, o tipo de ação e o motivo fixo, nunca o texto. */
export const ACOES_ROTINAS = [
  "rotina.criou",
  "rotina.editou",
  "rotina.ligou",
  "rotina.desligou",
  "rotina.apagou",
  "rotina.rodou_agora",
  "rotina.falhou",
] as const;
export type AcaoDeRotina = (typeof ACOES_ROTINAS)[number];
