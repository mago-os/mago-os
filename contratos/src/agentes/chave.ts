/**
 * Chave do agente (M2-04): como um agente externo prova quem é ao entrar pelo MCP. Ver docs/decisoes/0017.
 *
 * Formato: "mago_ag_" + 10 caracteres de identificação + "_" + 43 caracteres do segredo (32 bytes aleatórios em
 * base64url). O banco guarda só o começo (para reconhecer na lista e achar a chave) e o resumo SHA-256 da chave
 * inteira. A chave inteira aparece uma vez só, na hora de criar.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/** A chave inteira, como o agente manda no cabeçalho Authorization ("Bearer mago_ag_..."). */
export const FORMATO_DA_CHAVE = /^mago_ag_([0-9a-z]{10})_([A-Za-z0-9_-]{43})$/;

/** O começo da chave ("mago_ag_" + identificação), que fica no banco e aparece na lista. */
export const PrefixoDaChave = Type.String({
  pattern: "^mago_ag_[0-9a-z]{10}$",
  description: "Começo da chave, para reconhecê-la na lista. Não dá acesso a nada sozinho.",
});

export const ChaveDeAgente = Type.Object(
  {
    id: Id,
    empresaId: Id,
    agenteId: Id,
    nome: Texto(80, "Para que serve a chave (ex.: Mac do Sandro, troca de novembro)."),
    prefixo: PrefixoDaChave,
    criadaPor: Id,
    criadaEm: DataHora,
    validaAte: OuNulo(DataHora),
    ultimoUsoEm: OuNulo(DataHora),
    revogadaEm: OuNulo(DataHora),
    revogadaPor: OuNulo(Id),
  },
  { additionalProperties: false, description: "Chave de um agente (sem o segredo)." },
);
export type ChaveDeAgente = Static<typeof ChaveDeAgente>;

export const regrasDaChave: Regra<ChaveDeAgente>[] = [
  (k): Problema[] =>
    (k.revogadaEm === null) !== (k.revogadaPor === null)
      ? [{ caminho: "/revogadaPor", mensagem: "chave revogada diz quem revogou" }]
      : [],
  (k): Problema[] =>
    k.validaAte !== null && Date.parse(k.validaAte) <= Date.parse(k.criadaEm)
      ? [{ caminho: "/validaAte", mensagem: "a validade precisa ser depois da criação" }]
      : [],
];

export function conferirChaveDeAgente(valor: unknown) {
  return conferir(ChaveDeAgente, valor, regrasDaChave);
}

/** O que a API recebe para criar uma chave (só o administrador). Sem validade: vale até ser revogada. */
export const PedidoDeChave = Type.Object(
  {
    nome: Texto(80, "Para que serve a chave."),
    validaAte: Type.Optional(OuNulo(DataHora)),
  },
  { additionalProperties: false },
);
export type PedidoDeChave = Static<typeof PedidoDeChave>;

/** A resposta de criar: a chave inteira vem só aqui, uma vez. */
export const ChaveCriada = Type.Object(
  {
    chave: ChaveDeAgente,
    segredo: Type.String({
      pattern: FORMATO_DA_CHAVE.source,
      description: "A chave inteira. Mostrada uma vez só.",
    }),
  },
  { additionalProperties: false },
);
export type ChaveCriada = Static<typeof ChaveCriada>;

/** Por que uma chave foi recusada (vai para a auditoria, nunca a chave em si). */
export const MOTIVOS_DE_RECUSA = [
  "formato",
  "desconhecida",
  "revogada",
  "vencida",
  "agente_pausado",
  "agente_desligado",
  "passou_do_limite",
] as const;
export const MotivoDeRecusa = Type.Enum(MOTIVOS_DE_RECUSA);
export type MotivoDeRecusa = Static<typeof MotivoDeRecusa>;

/** Limites padrão por agente (plano: "limite de leitura por hora, padrão 500 registros"). */
export const LIMITES_DO_AGENTE = {
  /** Pedidos por minuto, por chave. Passou: pedido recusado e o agente pausado. */
  pedidosPorMinuto: 60,
  /** Registros lidos por hora, por agente (cada tarefa ou comentário devolvido conta 1). */
  leiturasPorHora: 500,
} as const;

/** Ações de auditoria das chaves. */
export const ACOES_CHAVES = ["chave.criou", "chave.revogou", "chave.recusou"] as const;

/**
 * Aviso para uma pessoa dentro do Mago OS (M2-04): o agente dela ficou sem sinal, passou do limite ou foi
 * desligado. Aparece no Início até ela marcar como lido; vai também por e-mail. Notificação push fica para o M3.
 */
/**
 * Tipos de aviso (notificação) para uma pessoa. Os de agente vêm da M2-04; os de tarefa, da M3-06: atribuída a
 * mim, menção, comentário numa tarefa que sigo, resultado entregue numa tarefa que criei, pedido de ajuda, prazo
 * vencendo hoje e prazo vencido.
 */
export const TIPOS_DE_AVISO = [
  "agente_sem_sinal",
  "agente_passou_do_limite",
  "agente_desligado",
  "tarefa_atribuida",
  "mencao",
  "comentario",
  "resultado_entregue",
  "precisa_de_ajuda",
  "prazo_hoje",
  "prazo_vencido",
  // M3-08: o antivírus bloqueou um anexo (vai para quem enviou e para os administradores).
  "anexo_bloqueado",
  // M4-03: um agente pediu aprovação (vai para quem pode aprovar) e a decisão (vai para o responsável do agente).
  "aprovacao_pedida",
  "aprovacao_decidida",
  "teto_de_gasto",
  // M4-09: os agentes foram parados (vai para os responsáveis e os administradores) e retomados.
  "agentes_parados",
  "agentes_retomados",
  // M5-01: a conta do Telegram da pessoa passou para outra pessoa (vai para quem perdeu).
  "telegram_desvinculado",
  // M5-04: três códigos errados travaram as aprovações pelo Telegram por 15 minutos (vai para a própria pessoa).
  "telegram_aprovacoes_travadas",
  // M5-05: o aviso que uma rotina manda (vai para quem o dono escolheu), a rotina que falhou três vezes (vai para o
  // dono, na central de prioridades) e as rotinas desligadas porque o dono saiu da empresa (vai para os
  // administradores).
  "aviso_de_rotina",
  "rotina_falhou",
  "rotina_desligada",
  // A rotina rodou e terminou bem (só para o dono que pediu "me avisar cada vez que rodar").
  "rotina_rodou",
  // M5-07: o convite para um evento (vai para os participantes, com os botões Vou, Não vou e Talvez no Telegram), a
  // mudança ou o cancelamento de um evento (para os participantes) e o alerta antes do começo.
  "convite_de_evento",
  "evento_mudou",
  "alerta_de_evento",
] as const;
export const TipoDeAviso = Type.Enum(TIPOS_DE_AVISO);
export type TipoDeAviso = Static<typeof TipoDeAviso>;

export const Aviso = Type.Object(
  {
    id: Id,
    empresaId: Id,
    pessoaId: Id,
    tipo: TipoDeAviso,
    texto: Texto(500, "O que aconteceu, numa frase."),
    link: Type.String({
      pattern: "^/[a-z0-9/_-]*$",
      maxLength: 200,
      description: "Tela do Mago OS a abrir.",
    }),
    criadoEm: DataHora,
    lidoEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Aviso para uma pessoa dentro do Mago OS." },
);
export type Aviso = Static<typeof Aviso>;

export function conferirAviso(valor: unknown) {
  return conferir(Aviso, valor);
}
