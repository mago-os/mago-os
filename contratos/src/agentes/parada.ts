/**
 * Parar todos os agentes (M4-09, decisão 0031): o freio de emergência da empresa.
 *
 * O administrador para todos os agentes da empresa; o Dono da plataforma, os de todas as empresas. Pede o segundo
 * fator recente e o motivo. Os agentes que estavam ativos ficam pausados e guardados na parada; as tarefas ficam como
 * estavam. A retomada (agente por agente ou todos juntos) também pede o segundo fator, e só devolve ao trabalho os
 * agentes que a parada pausou. Não é ferramenta de agente: só uma pessoa para e retoma.
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo, Texto } from "../comum.ts";

export const MAXIMO_DO_MOTIVO = 500;

/** Parar: o motivo vai para os avisos, para o aviso no topo e para a auditoria. */
export const PedidoDeParada = Type.Object(
  { motivo: Texto(MAXIMO_DO_MOTIVO, "Por que os agentes estão sendo parados.") },
  { additionalProperties: false },
);
export type PedidoDeParada = Static<typeof PedidoDeParada>;

/** Retomar: os agentes escolhidos, ou todos os da parada (agenteIds nulo). */
export const PedidoDeRetomada = Type.Object(
  { agenteIds: OuNulo(Type.Array(Id, { minItems: 1, maxItems: 500, uniqueItems: true })) },
  { additionalProperties: false },
);
export type PedidoDeRetomada = Static<typeof PedidoDeRetomada>;

/** Um agente que a parada pausou. */
export const AgenteDaParada = Type.Object(
  {
    agenteId: Id,
    nome: Type.String(),
    tipo: Type.Union([Type.Literal("interno"), Type.Literal("externo")]),
    /** Quando voltou ao trabalho (nulo: continua parado). */
    retomadoEm: OuNulo(DataHora),
    /** Execuções que estavam rodando e terminaram no passo atual; voltam à fila ao retomar. */
    execucoesInterrompidas: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type AgenteDaParada = Static<typeof AgenteDaParada>;

/** A parada da empresa (a ativa aparece no topo para os administradores). */
export const Parada = Type.Object(
  {
    id: Id,
    motivo: Type.String(),
    paradaPor: Type.Object({ id: Id, nome: Type.String() }, { additionalProperties: false }),
    paradaEm: DataHora,
    /** Feita pelo Dono da plataforma: só ele retoma. */
    daPlataforma: Type.Boolean(),
    /** Nula enquanto algum agente da parada continua parado. */
    retomadaEm: OuNulo(DataHora),
    agentes: Type.Array(AgenteDaParada),
  },
  { additionalProperties: false },
);
export type Parada = Static<typeof Parada>;

/** Como a parada termina uma execução que estava rodando. */
export const RESUMO_DA_PARADA = "Parada por um administrador (Parar todos os agentes).";

/** Ações de auditoria. */
export const ACOES_PARADA = ["agentes.parou_todos", "agentes.retomou"] as const;
