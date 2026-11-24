/**
 * Agenda simples (M5-07, decisão 0041): eventos com participantes da empresa, recorrência, convite com resposta e
 * alertas por tela, push e Telegram. Decisões do Sandro na spec do M5 (22/11/2026):
 * 14. Eventos com participantes da empresa, recorrência com "só este, este e os seguintes ou todos", convite com
 *     resposta, vários alertas (padrão 10 minutos antes) e o calendário juntando eventos e prazos. Clientes,
 *     Google Agenda, Outlook e link de agendamento ficam para a Fase 2.
 * 15. O evento é visto por quem criou, pelos participantes e pelos administradores; o funcionário vê só "ocupado" na
 *     agenda de um colega.
 *
 * O começo e o fim são guardados como dia e hora no fuso do evento (como o prazo das tarefas); o banco calcula o
 * momento, com o horário de verão de cada lugar.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Dia, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { FusoHorario } from "../identidade/pessoa.ts";
import { Hora, RegraDeRecorrencia } from "../tarefas/prazos.ts";

/** Até 5 alertas por evento, de 0 a 7 dias antes (em minutos). */
export const MAXIMO_DE_ALERTAS = 5;
export const MINUTOS_MAXIMOS_DO_ALERTA = 7 * 24 * 60;
/** O alerta padrão de quem não escolheu: 10 minutos antes. */
export const ALERTAS_PADRAO = [10] as const;
/** Um evento dura no máximo 14 dias. */
export const DIAS_MAXIMOS_DO_EVENTO = 14;
/** Até 50 participantes por evento. */
export const MAXIMO_DE_PARTICIPANTES = 50;
/** Na listagem, no máximo 62 dias de uma vez (o mês do calendário com folga). */
export const DIAS_MAXIMOS_DA_LISTAGEM = 62;

export const Alertas = Type.Array(Type.Integer({ minimum: 0, maximum: MINUTOS_MAXIMOS_DO_ALERTA }), {
  maxItems: MAXIMO_DE_ALERTAS,
  uniqueItems: true,
  description: "Minutos antes do começo em que o alerta chega (0 = na hora).",
});

/** Um momento do evento: o dia e, fora do dia inteiro, a hora, no fuso do evento. */
export const MomentoDoEvento = Type.Object(
  { dia: Dia, hora: Type.Optional(OuNulo(Hora)) },
  { additionalProperties: false },
);
export type MomentoDoEvento = Static<typeof MomentoDoEvento>;

export const RESPOSTAS_AO_CONVITE = ["pendente", "vou", "nao_vou", "talvez"] as const;
export const RespostaAoConvite = Type.Enum(RESPOSTAS_AO_CONVITE);
export type RespostaAoConvite = Static<typeof RespostaAoConvite>;

export const NOMES_DAS_RESPOSTAS: Record<RespostaAoConvite, string> = {
  pendente: "Sem resposta",
  vou: "Vou",
  nao_vou: "Não vou",
  talvez: "Talvez",
};

export const Participante = Type.Object(
  { pessoaId: Id, resposta: RespostaAoConvite, respondeuEm: OuNulo(DataHora) },
  { additionalProperties: false },
);
export type Participante = Static<typeof Participante>;

export const SITUACOES_DO_EVENTO = ["marcado", "cancelado"] as const;
export const SituacaoDoEvento = Type.Enum(SITUACOES_DO_EVENTO);
export type SituacaoDoEvento = Static<typeof SituacaoDoEvento>;

const TituloDoEvento = Texto(200, "O que é o evento (ex.: Reunião com a Ana).");
const LinkDoEvento = Type.String({
  pattern: "^https://[^\\s]+$",
  maxLength: 500,
  description: "Link da reunião (https).",
});

/**
 * O evento (ou a série, quando tem regra). A ocorrência mudada de uma série é um evento próprio, ligado a ela
 * (serieId) e à ocorrência que substitui (ocorrenciaOriginal); a ocorrência cancelada também.
 */
export const EventoDaAgenda = Type.Object(
  {
    id: Id,
    empresaId: Id,
    titulo: TituloDoEvento,
    descricao: OuNulo(Texto(10000, "Detalhes do evento.")),
    inicio: MomentoDoEvento,
    fim: MomentoDoEvento,
    diaInteiro: Type.Boolean(),
    fuso: FusoHorario,
    /** O momento do começo e do fim (calculados no fuso; dia inteiro: do começo do primeiro dia ao fim do último). */
    inicioEm: DataHora,
    fimEm: DataHora,
    local: OuNulo(Texto(300, "Onde (endereço ou sala).")),
    link: OuNulo(LinkDoEvento),
    criadoPor: Id,
    /** O agente que criou o evento pela ferramenta (a pedido de quem criou, com a aprovação dele), se foi assim. */
    criadoPorAgenteId: OuNulo(Id),
    participantes: Type.Array(Participante, { maxItems: MAXIMO_DE_PARTICIPANTES }),
    tarefaId: OuNulo(Id),
    projetoId: OuNulo(Id),
    /** A recorrência (as mesmas regras das tarefas), contada a partir do dia do começo. */
    regra: OuNulo(RegraDeRecorrencia),
    serieId: OuNulo(Id),
    ocorrenciaOriginal: OuNulo(Dia),
    situacao: SituacaoDoEvento,
    /** Os alertas do evento, para todos; nulo: cada participante usa o padrão dele (10 minutos antes). */
    alertas: OuNulo(Alertas),
    criadoEm: DataHora,
    atualizadoEm: DataHora,
  },
  { additionalProperties: false, description: "Evento da agenda simples." },
);
export type EventoDaAgenda = Static<typeof EventoDaAgenda>;

/**
 * Uma vez do evento no calendário. Para quem não pode ver o evento (o funcionário olhando a agenda de um colega),
 * vem só "ocupado": sem título, local, link nem participantes.
 */
export const OcorrenciaNaAgenda = Type.Object(
  {
    eventoId: Id,
    /** O dia da ocorrência na série (para editar ou cancelar "só este"). */
    ocorrencia: Dia,
    inicioEm: DataHora,
    fimEm: DataHora,
    diaInteiro: Type.Boolean(),
    recorrente: Type.Boolean(),
    ocupado: Type.Boolean(),
    titulo: OuNulo(TituloDoEvento),
    /** De quem é a agenda em que aparece (os participantes e quem criou que o filtro pediu). */
    pessoas: Type.Array(Id),
    minhaResposta: OuNulo(RespostaAoConvite),
  },
  { additionalProperties: false },
);
export type OcorrenciaNaAgenda = Static<typeof OcorrenciaNaAgenda>;

/** O fim vem depois do começo, os dois com hora ou os dois sem (dia inteiro), e no máximo 14 dias depois. */
function problemasDoMomento(inicio: MomentoDoEvento, fim: MomentoDoEvento, diaInteiro: boolean): Problema[] {
  const problemas: Problema[] = [];
  const temHora = (m: MomentoDoEvento) => m.hora !== undefined && m.hora !== null;
  if (diaInteiro && (temHora(inicio) || temHora(fim)))
    problemas.push({ caminho: "/inicio/hora", mensagem: "evento de dia inteiro não tem hora" });
  if (!diaInteiro && (!temHora(inicio) || !temHora(fim)))
    problemas.push({
      caminho: "/inicio/hora",
      mensagem: "evento com horário precisa da hora do começo e do fim",
    });
  const a = `${inicio.dia}T${inicio.hora ?? "00:00"}`;
  const b = `${fim.dia}T${fim.hora ?? "00:00"}`;
  if (diaInteiro ? b < a : b <= a)
    problemas.push({ caminho: "/fim", mensagem: "o fim vem depois do começo" });
  const dias = (Date.parse(fim.dia) - Date.parse(inicio.dia)) / 86_400_000;
  if (dias > DIAS_MAXIMOS_DO_EVENTO)
    problemas.push({ caminho: "/fim", mensagem: `um evento dura no máximo ${DIAS_MAXIMOS_DO_EVENTO} dias` });
  return problemas;
}

function problemasDaRegra(regra: RegraDeRecorrencia | null | undefined): Problema[] {
  if (!regra) return [];
  const problemas: Problema[] = [];
  if (regra.diasDaSemana && regra.frequencia !== "semanal")
    problemas.push({ caminho: "/regra/diasDaSemana", mensagem: "dias da semana só na repetição semanal" });
  if (regra.diaDoMes !== undefined && regra.frequencia !== "mensal")
    problemas.push({ caminho: "/regra/diaDoMes", mensagem: "dia do mês só na repetição mensal" });
  return problemas;
}

/** Criar um evento. Sem fuso, vale o de quem cria. Quem cria já é participante (resposta "vou"). */
export const PedidoDeEvento = Type.Object(
  {
    titulo: TituloDoEvento,
    descricao: Type.Optional(OuNulo(Texto(10000, "Detalhes do evento."))),
    inicio: MomentoDoEvento,
    fim: MomentoDoEvento,
    diaInteiro: Type.Optional(Type.Boolean()),
    fuso: Type.Optional(FusoHorario),
    local: Type.Optional(OuNulo(Texto(300, "Onde (endereço ou sala)."))),
    link: Type.Optional(OuNulo(LinkDoEvento)),
    participantes: Type.Array(Id, { maxItems: MAXIMO_DE_PARTICIPANTES, uniqueItems: true }),
    tarefaId: Type.Optional(OuNulo(Id)),
    projetoId: Type.Optional(OuNulo(Id)),
    regra: Type.Optional(OuNulo(RegraDeRecorrencia)),
    alertas: Type.Optional(OuNulo(Alertas)),
  },
  { additionalProperties: false },
);
export type PedidoDeEvento = Static<typeof PedidoDeEvento>;

export function conferirPedidoDeEvento(valor: unknown) {
  return conferir(PedidoDeEvento, valor, [
    (e) => problemasDoMomento(e.inicio, e.fim, e.diaInteiro ?? false),
    (e) => problemasDaRegra(e.regra),
  ]);
}

/** Numa série, a mudança vale só para esta ocorrência, para esta e as seguintes, ou para todas (decisão 14). */
export const ALCANCES_DA_MUDANCA = ["so_este", "este_e_seguintes", "todos"] as const;
export const AlcanceDaMudanca = Type.Enum(ALCANCES_DA_MUDANCA);
export type AlcanceDaMudanca = Static<typeof AlcanceDaMudanca>;

/**
 * Editar (quem criou e o administrador). Só o que veio muda. Num evento com recorrência, diga o alcance e a
 * ocorrência (o dia dela na série).
 */
export const PedidoDeEdicaoDeEvento = Type.Object(
  {
    titulo: Type.Optional(TituloDoEvento),
    descricao: Type.Optional(OuNulo(Texto(10000, "Detalhes do evento."))),
    inicio: Type.Optional(MomentoDoEvento),
    fim: Type.Optional(MomentoDoEvento),
    diaInteiro: Type.Optional(Type.Boolean()),
    fuso: Type.Optional(FusoHorario),
    local: Type.Optional(OuNulo(Texto(300, "Onde (endereço ou sala)."))),
    link: Type.Optional(OuNulo(LinkDoEvento)),
    participantes: Type.Optional(Type.Array(Id, { maxItems: MAXIMO_DE_PARTICIPANTES, uniqueItems: true })),
    tarefaId: Type.Optional(OuNulo(Id)),
    projetoId: Type.Optional(OuNulo(Id)),
    regra: Type.Optional(OuNulo(RegraDeRecorrencia)),
    alertas: Type.Optional(OuNulo(Alertas)),
    alcance: Type.Optional(AlcanceDaMudanca),
    ocorrencia: Type.Optional(Dia),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEdicaoDeEvento = Static<typeof PedidoDeEdicaoDeEvento>;

export function conferirPedidoDeEdicaoDeEvento(valor: unknown) {
  return conferir(PedidoDeEdicaoDeEvento, valor, [
    (e) => problemasDaRegra(e.regra),
    (e): Problema[] =>
      e.alcance && e.alcance !== "todos" && !e.ocorrencia
        ? [{ caminho: "/ocorrencia", mensagem: "diga qual ocorrência mudar" }]
        : [],
  ]);
}

/** Cancelar (quem criou e o administrador): o evento inteiro ou, numa série, o alcance escolhido. */
export const PedidoDeCancelamento = Type.Object(
  { alcance: Type.Optional(AlcanceDaMudanca), ocorrencia: Type.Optional(Dia) },
  { additionalProperties: false },
);
export type PedidoDeCancelamento = Static<typeof PedidoDeCancelamento>;

/** A resposta ao convite (só o próprio participante), no app ou pelos botões do Telegram. */
export const PedidoDeResposta = Type.Object(
  { resposta: Type.Enum(["vou", "nao_vou", "talvez"] as const) },
  { additionalProperties: false },
);
export type PedidoDeResposta = Static<typeof PedidoDeResposta>;

/** Ações de auditoria da agenda. Nos detalhes vão ids, o alcance e a resposta, nunca o título. */
export const ACOES_AGENDA = ["evento.criou", "evento.editou", "evento.cancelou", "evento.respondeu"] as const;
export type AcaoDaAgenda = (typeof ACOES_AGENDA)[number];
