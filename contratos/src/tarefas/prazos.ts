/**
 * Prioridade, prazo, etiquetas e recorrência da tarefa (M3-03).
 *
 * Decisões do Sandro (19/11/2026, spec M3-projetos):
 * 6. Prioridades: Urgente, Alta, Normal, Baixa, ou sem prioridade.
 * 7. Recorrência: ao concluir uma tarefa recorrente, nasce a próxima com o próximo prazo (não acumula tarefas se uma
 *    atrasar). As contas são feitas no fuso do prazo.
 *
 * O prazo é um dia, com hora se a pessoa quiser, sempre guardado com o fuso em que foi marcado (o da empresa, se
 * ninguém escolher). Prazo com hora a tela mostra no fuso de quem vê; prazo só com o dia vale o dia inteiro.
 */
import { type Static, Type } from "typebox";
import { Cor, conferir, DataHora, Dia, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { FusoHorario } from "../identidade/pessoa.ts";

export const PRIORIDADES = ["urgente", "alta", "normal", "baixa"] as const;
export const Prioridade = Type.Enum(PRIORIDADES, { description: "urgente, alta, normal ou baixa." });
export type Prioridade = Static<typeof Prioridade>;

export const NOMES_PRIORIDADE: Record<Prioridade, string> = {
  urgente: "Urgente",
  alta: "Alta",
  normal: "Normal",
  baixa: "Baixa",
};

/** Hora do dia, de 00:00 a 23:59. */
export const Hora = Type.String({
  pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
  description: "Hora no formato HH:MM.",
});

export const Prazo = Type.Object(
  {
    dia: Dia,
    /** Sem hora: vale o dia inteiro. */
    hora: OuNulo(Hora),
    /** Fuso em que o prazo foi marcado (IANA, ex.: America/Sao_Paulo). */
    fuso: FusoHorario,
    /** O momento do prazo, calculado: com hora, aquela hora; só o dia, 23:59 do dia no fuso. Para ordenar e avisar. */
    em: DataHora,
  },
  {
    additionalProperties: false,
    description: "Prazo da tarefa: um dia, com hora opcional, no fuso em que foi marcado.",
  },
);
export type Prazo = Static<typeof Prazo>;

/** O que se manda para marcar um prazo (o momento é calculado). Sem fuso, vale o da empresa. */
export const PedidoDePrazo = Type.Object(
  { dia: Dia, hora: Type.Optional(OuNulo(Hora)), fuso: Type.Optional(FusoHorario) },
  { additionalProperties: false },
);
export type PedidoDePrazo = Static<typeof PedidoDePrazo>;

export const FREQUENCIAS = ["diaria", "semanal", "mensal", "anual"] as const;
export const Frequencia = Type.Enum(FREQUENCIAS, { description: "diaria, semanal, mensal ou anual." });
export type Frequencia = Static<typeof Frequencia>;

/**
 * Regra da recorrência. Exemplos: todo dia (diaria, intervalo 1); a cada 3 dias (diaria, intervalo 3); toda segunda
 * e quinta (semanal, diasDaSemana [1, 4]); todo mês no dia 10 (mensal, diaDoMes 10); todo ano (anual).
 * Para numa data (ate) ou depois de um número de vezes (vezes), o que vier primeiro. Precisa de prazo na tarefa.
 */
export const RegraDeRecorrencia = Type.Object(
  {
    frequencia: Frequencia,
    intervalo: Type.Integer({
      minimum: 1,
      maximum: 365,
      description: "A cada quantos dias, semanas, meses ou anos.",
    }),
    /** Só na semanal: 0 = domingo ... 6 = sábado. Sem eles, o mesmo dia da semana do prazo. */
    diasDaSemana: Type.Optional(
      Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7, uniqueItems: true }),
    ),
    /** Só na mensal: o dia do mês (31 cai no último dia dos meses mais curtos). Sem ele, o dia do prazo. */
    diaDoMes: Type.Optional(Type.Integer({ minimum: 1, maximum: 31 })),
    /** Para depois deste dia (inclusive). */
    ate: Type.Optional(OuNulo(Dia)),
    /** Para depois de tantas vezes no total (contando a primeira). */
    vezes: Type.Optional(OuNulo(Type.Integer({ minimum: 1, maximum: 1000 }))),
  },
  { additionalProperties: false, description: "Como a tarefa se repete." },
);
export type RegraDeRecorrencia = Static<typeof RegraDeRecorrencia>;

export function conferirRegraDeRecorrencia(valor: unknown) {
  return conferir(RegraDeRecorrencia, valor, [
    (r): Problema[] => {
      const problemas: Problema[] = [];
      if (r.diasDaSemana && r.frequencia !== "semanal") {
        problemas.push({ caminho: "/diasDaSemana", mensagem: "dias da semana só na recorrência semanal" });
      }
      if (r.diaDoMes !== undefined && r.frequencia !== "mensal") {
        problemas.push({ caminho: "/diaDoMes", mensagem: "dia do mês só na recorrência mensal" });
      }
      return problemas;
    },
  ]);
}

const NomeDaEtiqueta = Texto(40, "Nome da etiqueta (ex.: Cliente, Urgente do mês).");

export const Etiqueta = Type.Object(
  { id: Id, empresaId: Id, nome: NomeDaEtiqueta, cor: Cor, criadaEm: DataHora },
  { additionalProperties: false, description: "Etiqueta da empresa, para marcar tarefas." },
);
export type Etiqueta = Static<typeof Etiqueta>;

export function conferirEtiqueta(valor: unknown) {
  return conferir(Etiqueta, valor);
}

/** Criar uma etiqueta (quem edita tarefas). */
export const PedidoDeEtiqueta = Type.Object(
  { nome: NomeDaEtiqueta, cor: Cor },
  { additionalProperties: false },
);
export type PedidoDeEtiqueta = Static<typeof PedidoDeEtiqueta>;

/** Prioridade, prazo, início, etiquetas e recorrência de uma tarefa. Só o que veio muda; nulo apaga. */
export const PedidoDePlanejamento = Type.Object(
  {
    prioridade: Type.Optional(OuNulo(Prioridade)),
    prazo: Type.Optional(OuNulo(PedidoDePrazo)),
    inicio: Type.Optional(OuNulo(Dia)),
    etiquetas: Type.Optional(Type.Array(Id, { maxItems: 20, uniqueItems: true })),
    recorrencia: Type.Optional(OuNulo(RegraDeRecorrencia)),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDePlanejamento = Static<typeof PedidoDePlanejamento>;

/** Ações de auditoria da M3-03. Nos detalhes vão ids e valores fixos (prioridade, dia), nunca texto. */
export const ACOES_PRAZOS = [
  "tarefa.mudou_prioridade",
  "tarefa.mudou_prazo",
  "tarefa.mudou_etiquetas",
  "tarefa.mudou_recorrencia",
  "tarefa.recorreu",
  "etiqueta.criou",
  "etiqueta.excluiu",
] as const;
