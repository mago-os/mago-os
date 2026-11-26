/**
 * Webhooks de saída (M7-03, decisão 0048): o Mago OS avisa um sistema de fora (n8n, Make, o site da empresa) quando
 * algo acontece. Cada aviso sai assinado (HMAC SHA-256 com o segredo do webhook e a hora), com um número único, e leva
 * só o que mudou e os ids: quem precisar do resto busca pela API pública (M7-02), com a própria chave.
 *
 * A entrega é pela fila, com novas tentativas por até 24 horas. Um webhook que falha há 3 dias é desligado, e o
 * administrador é avisado. Os mesmos avisos servem ao aviso imediato dos agentes externos (M7-04).
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, Texto } from "../comum.ts";

/** Os eventos do começo (spec do M7). "webhook.teste" é o do botão "Mandar teste". */
export const EVENTOS_DE_WEBHOOK = [
  "tarefa.criada",
  "tarefa.atualizada",
  "tarefa.concluida",
  "tarefa.comentada",
  "contato.criado",
  "contato.atualizado",
  "aprovacao.pedida",
  "aprovacao.respondida",
] as const;
export const EventoDeWebhook = Type.Enum(EVENTOS_DE_WEBHOOK);
export type EventoDeWebhook = Static<typeof EventoDeWebhook>;

export const NOMES_DOS_EVENTOS_DE_WEBHOOK: Record<EventoDeWebhook, string> = {
  "tarefa.criada": "Tarefa criada",
  "tarefa.atualizada": "Tarefa mudou (título, descrição, status, responsável, prazo, prioridade ou projeto)",
  "tarefa.concluida": "Tarefa concluída",
  "tarefa.comentada": "Comentário numa tarefa (não as notas internas)",
  "contato.criado": "Contato cadastrado",
  "contato.atualizado": "Contato mudou",
  "aprovacao.pedida": "Um agente pediu aprovação",
  "aprovacao.respondida": "Uma aprovação foi respondida",
};

/** Só https, sem usuário e senha no endereço, até 500 caracteres. O núcleo também recusa IP de rede interna. */
export const EnderecoDoWebhook = Type.String({
  pattern: "^https://[^\\s/@]+(/[^\\s]*)?$",
  maxLength: 500,
  description: "Endereço https que recebe os avisos (ex.: https://n8n.minhaempresa.com/webhook/mago).",
});

/** Até 10 webhooks por empresa. */
export const MAXIMO_DE_WEBHOOKS = 10;

export const SITUACOES_DO_WEBHOOK = ["ligado", "desligado"] as const;
export const SituacaoDoWebhook = Type.Enum(SITUACOES_DO_WEBHOOK);
export type SituacaoDoWebhook = Static<typeof SituacaoDoWebhook>;

/** Por que o webhook está desligado: a pessoa desligou, ou o sistema depois de 3 dias falhando. */
export const MOTIVOS_DO_WEBHOOK_DESLIGADO = ["manual", "falhas"] as const;

export const Webhook = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: Texto(80, "Para que serve (ex.: n8n da 4xpert)."),
    url: EnderecoDoWebhook,
    eventos: Type.Array(EventoDeWebhook, { minItems: 1, uniqueItems: true }),
    situacao: SituacaoDoWebhook,
    desligadoPorque: OuNulo(Type.Enum(MOTIVOS_DO_WEBHOOK_DESLIGADO)),
    /** Os 4 últimos caracteres do segredo, para reconhecer qual está em uso (o segredo inteiro aparece uma vez). */
    finalDoSegredo: Type.String({ pattern: "^[A-Za-z0-9_-]{4}$" }),
    /** Desde quando as entregas falham sem nenhum acerto no meio (nulo: está entregando). */
    falhandoDesde: OuNulo(DataHora),
    ultimaEntregaEm: OuNulo(DataHora),
    criadoPor: Id,
    criadoEm: DataHora,
    atualizadoEm: DataHora,
  },
  { additionalProperties: false, description: "Webhook de saída da empresa (sem o segredo)." },
);
export type Webhook = Static<typeof Webhook>;

/** Criar (só o administrador). O segredo é gerado pelo Mago OS e vem só na resposta. */
export const PedidoDeWebhook = Type.Object(
  {
    nome: Texto(80, "Para que serve."),
    url: EnderecoDoWebhook,
    eventos: Type.Array(EventoDeWebhook, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type PedidoDeWebhook = Static<typeof PedidoDeWebhook>;

/** Editar: só o que veio muda. Ligar de novo zera a contagem de falhas. */
export const PedidoDeEditarWebhook = Type.Object(
  {
    nome: Type.Optional(Texto(80, "Para que serve.")),
    url: Type.Optional(EnderecoDoWebhook),
    eventos: Type.Optional(Type.Array(EventoDeWebhook, { minItems: 1, uniqueItems: true })),
    situacao: Type.Optional(SituacaoDoWebhook),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarWebhook = Static<typeof PedidoDeEditarWebhook>;

export function conferirPedidoDeWebhook(valor: unknown) {
  return conferir(PedidoDeWebhook, valor, [problemasDoEndereco]);
}
export function conferirPedidoDeEditarWebhook(valor: unknown) {
  return conferir(PedidoDeEditarWebhook, valor, [problemasDoEndereco]);
}

/** Endereço de rede interna escrito direto (localhost, 10.x, 192.168.x...): recusado já no contrato. */
function problemasDoEndereco(p: { url?: string }): Problema[] {
  if (!p.url) return [];
  let host = "";
  try {
    host = new URL(p.url).hostname.toLowerCase();
  } catch {
    return [{ caminho: "/url", mensagem: "endereço inválido" }];
  }
  const interno =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^(127|10|0)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.startsWith("[");
  return interno ? [{ caminho: "/url", mensagem: "use um endereço público (não de rede interna)" }] : [];
}

/** A resposta de criar e de trocar o segredo: o segredo inteiro vem só aqui. */
export const WebhookCriado = Type.Object(
  {
    webhook: Webhook,
    segredo: Type.String({
      pattern: "^whsec_[A-Za-z0-9_-]{43}$",
      description: "O segredo. Mostrado uma vez só.",
    }),
  },
  { additionalProperties: false },
);
export type WebhookCriado = Static<typeof WebhookCriado>;

/**
 * O corpo de cada aviso (JSON). Só ids e os nomes dos campos que mudaram, nunca o texto: quem recebe busca o resto pela
 * API pública. "id" é o número único da entrega do evento (o mesmo em todas as tentativas): quem recebe ignora o que
 * já recebeu.
 */
export const AvisoDoWebhook = Type.Object(
  {
    id: Id,
    evento: Type.Union([EventoDeWebhook, Type.Literal("webhook.teste")]),
    ocorridoEm: DataHora,
    empresaId: Id,
    dados: Type.Object(
      {
        tipo: Type.Enum(["tarefa", "contato", "aprovacao", "webhook"] as const),
        id: Id,
        /** A tarefa do comentário ou da aprovação, quando há. */
        tarefaId: Type.Optional(OuNulo(Id)),
        /** Os nomes dos campos que mudaram (no "atualizada"). */
        campos: Type.Optional(Type.Array(Type.String())),
        /** O status novo (na tarefa) ou a decisão (na aprovação). */
        status: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, description: "O corpo do aviso que o webhook recebe." },
);
export type AvisoDoWebhook = Static<typeof AvisoDoWebhook>;

/**
 * Cabeçalhos do aviso. A assinatura é "t=<segundos desde 1970>,v1=<HMAC SHA-256 em hex de "<t>.<corpo>">", com o
 * segredo do webhook. Quem recebe confere a assinatura e recusa aviso com mais de 5 minutos.
 */
export const CABECALHO_DA_ASSINATURA = "mago-assinatura";
export const CABECALHO_DO_EVENTO = "mago-evento";
export const CABECALHO_DA_ENTREGA = "mago-entrega";
export const MINUTOS_DE_TOLERANCIA_DA_ASSINATURA = 5;

/** As esperas entre as tentativas (em minutos): 1, 5, 30, 2h, 6h e 12h, somando um pouco mais de 20 horas. */
export const ESPERAS_DAS_TENTATIVAS = [1, 5, 30, 120, 360, 720] as const;
/** Cada tentativa espera a resposta por até 10 segundos; vale qualquer resposta 2xx. */
export const SEGUNDOS_DE_ESPERA_DA_RESPOSTA = 10;
/** Falhando há 3 dias sem nenhum acerto, o webhook é desligado e o administrador avisado. */
export const DIAS_FALHANDO_ATE_DESLIGAR = 3;
/** O histórico das entregas fica 30 dias. */
export const DIAS_DO_HISTORICO_DE_ENTREGAS = 30;

export const SITUACOES_DA_ENTREGA = ["esperando", "entregue", "falhou", "desistiu"] as const;
export const SituacaoDaEntrega = Type.Enum(SITUACOES_DA_ENTREGA, {
  description:
    "esperando (na fila ou para tentar de novo), entregue, falhou (vai tentar de novo) ou desistiu.",
});

export const EntregaDeWebhook = Type.Object(
  {
    id: Id,
    webhookId: Id,
    evento: Type.String(),
    situacao: SituacaoDaEntrega,
    tentativas: Type.Integer({ minimum: 0 }),
    /** O código HTTP da última resposta (nulo: não chegou a responder). */
    ultimoCodigo: OuNulo(Type.Integer()),
    /** O que deu errado, em português (nunca o corpo da resposta). */
    ultimoErro: OuNulo(Type.String({ maxLength: 300 })),
    ultimoTempoMs: OuNulo(Type.Integer({ minimum: 0 })),
    proximaEm: OuNulo(DataHora),
    criadaEm: DataHora,
    entregueEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Uma entrega de um aviso, com as tentativas." },
);
export type EntregaDeWebhook = Static<typeof EntregaDeWebhook>;

/** Ações de auditoria dos webhooks. Nos detalhes vão ids, os eventos e o motivo, nunca o segredo nem o endereço todo. */
export const ACOES_WEBHOOKS = [
  "webhook.criou",
  "webhook.editou",
  "webhook.trocou_segredo",
  "webhook.apagou",
  "webhook.desligou_por_falhas",
  "webhook.reenviou",
] as const;
export type AcaoDosWebhooks = (typeof ACOES_WEBHOOKS)[number];
