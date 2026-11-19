/**
 * Central de prioridades (M3-07): uma lista por pessoa, calculada na hora a partir do que já existe (tarefas,
 * menções e avisos). Só o "adiado" e o "resolvido" de cada item ficam guardados, e são só da pessoa.
 * Ordem por regras fixas, sem IA (decisão 13): atrasadas, vence hoje, precisa de ajuda, menções, avisos de agentes,
 * e em cada grupo a mais antiga primeiro. As aprovações pedidas por agentes chegam na M4-03 e já têm o seu lugar.
 */
import { type Static, Type } from "typebox";
import { DataHora, Dia, Id, OuNulo, Texto } from "../comum.ts";

/** Na ordem em que aparecem na lista. */
export const TIPOS_DE_PRIORIDADE = [
  "atrasada",
  "vence_hoje",
  "precisa_de_ajuda",
  "mencao",
  "aviso_de_agente",
  "aprovacao",
] as const;
export const TipoDePrioridade = Type.Enum(TIPOS_DE_PRIORIDADE, {
  description:
    "atrasada e vence_hoje: tarefa minha (sou o responsável, ou o dono do agente responsável); precisa_de_ajuda: tarefa minha nesse status; mencao: menção a mim sem resposta minha depois dela; aviso_de_agente: aviso de agente não lido; aprovacao: pedido de aprovação (M4-03).",
});
export type TipoDePrioridade = Static<typeof TipoDePrioridade>;

/**
 * Chave do item, estável enquanto a situação não muda: "tarefa:<id>:<prazo>" (mudar o prazo cria um item novo),
 * "ajuda:<id>", "mencao:<comentário>", "aviso:<id>". É por ela que se adia e se resolve.
 */
export const ChaveDePrioridade = Texto(160, "Chave do item na central.");

export const ItemDePrioridade = Type.Object(
  {
    chave: ChaveDePrioridade,
    tipo: TipoDePrioridade,
    /** Título da tarefa, ou o texto do aviso. */
    titulo: Texto(500, "O que é."),
    /** Uma linha: "vence hoje às 14h", "mencionado por Ana há 2 dias". */
    motivo: Texto(200, "Por que está na lista."),
    link: Texto(300, "Para onde abrir."),
    tarefaId: OuNulo(Id),
    /** Momento que ordena dentro do grupo (prazo, menção, aviso). */
    desde: DataHora,
  },
  { additionalProperties: false, description: "Um item da central de prioridades." },
);
export type ItemDePrioridade = Static<typeof ItemDePrioridade>;

export const PedidoDeAdiarPrioridade = Type.Object(
  {
    chave: ChaveDePrioridade,
    /** Volta no começo desse dia, no fuso da pessoa. A tela oferece amanhã, segunda e escolher a data. */
    ate: Dia,
  },
  { additionalProperties: false },
);
export type PedidoDeAdiarPrioridade = Static<typeof PedidoDeAdiarPrioridade>;

/** Resolver tira o item até a situação mudar. Aviso de agente resolvido fica lido. */
export const PedidoDeResolverPrioridade = Type.Object(
  { chave: ChaveDePrioridade },
  { additionalProperties: false },
);
export type PedidoDeResolverPrioridade = Static<typeof PedidoDeResolverPrioridade>;
