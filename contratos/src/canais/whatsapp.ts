/**
 * O WhatsApp oficial da plataforma para a equipe (M8-09, decisão 0059): o número oficial do Mago OS (no começo, o
 * número de teste do app "Mago OS" da Nolask na Meta) faz pela equipe o mesmo que o bot do Telegram (M5): vincular a
 * conta por código, falar com o coordenador, aprovar com botões e o código do autenticador, e receber os avisos
 * urgentes e o resumo do dia. As regras do código de vínculo, das travas e das aprovações são as mesmas do Telegram.
 *
 * Fora da janela de 24 horas da Meta (contada da última mensagem da pessoa), só sai mensagem por modelo aprovado, que
 * a Nolask paga: no máximo 10 por pessoa por dia.
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo } from "../comum.ts";
import { FormatoDoCodigoDoTelegram } from "./telegram.ts";

/** A janela da Meta: depois de 24 horas da última mensagem da pessoa, só por modelo aprovado. */
export const HORAS_DA_JANELA_DO_WHATSAPP = 24;
/** No máximo, quantas mensagens por modelo (pagas pela Nolask) cada pessoa recebe por dia. */
export const MODELOS_POR_DIA_NO_WHATSAPP = 10;
/** A Meta aceita até 4096 letras numa mensagem de texto. */
export const MAXIMO_DA_MENSAGEM_DO_WHATSAPP = 4096;

/**
 * Os modelos na Meta (Utilidade, pt_BR), um por tipo de aviso: {{1}} é o primeiro nome da pessoa e {{2}} o título da
 * tarefa (ou o nome do agente, no pedido de aprovação). O modelo geral (aviso_do_mago_os) ficou de fora: a Meta não
 * aceita como Utilidade um modelo com o aviso inteiro numa variável (escolha do Sandro em 28/11/2026). Os outros
 * avisos urgentes, fora da janela de 24 horas, ficam no app e no Telegram.
 */
export const MODELOS_DO_WHATSAPP = {
  // Os _v2 substituem os de 27/11/2026, que ficaram com os exemplos dentro do corpo.
  tarefaAtribuida: "tarefa_atribuida_v2",
  lembreteDeTarefa: "lembrete_de_tarefa_v2",
  mencao: "mencao_na_tarefa",
  aprovacao: "aprovacao_pedida",
} as const;

/** O que Meu perfil recebe ao gerar o código: o link do wa.me já com o código. */
export const CodigoDoWhatsapp = Type.Object(
  {
    codigo: FormatoDoCodigoDoTelegram,
    link: Type.String({ pattern: "^https://wa\\.me/[0-9]{8,15}\\?text=[A-Z0-9]+$" }),
    venceEm: DataHora,
  },
  { additionalProperties: false, description: "Código de uso único para vincular o WhatsApp." },
);
export type CodigoDoWhatsapp = Static<typeof CodigoDoWhatsapp>;

/** Meu perfil › WhatsApp: se está ligado neste ambiente, o número do Mago OS e o vínculo (ou nulo). */
export const SituacaoDoWhatsapp = Type.Object(
  {
    ligado: Type.Boolean(),
    vinculo: OuNulo(
      Type.Object(
        {
          /** Os 4 últimos números do WhatsApp da pessoa (o número inteiro não sai daqui). */
          finalDoNumero: Type.String({ pattern: "^[0-9]{4}$" }),
          nome: Type.String({ maxLength: 200 }),
          empresa: Type.Object({ id: Id, nome: Type.String() }, { additionalProperties: false }),
          vinculadoEm: DataHora,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type SituacaoDoWhatsapp = Static<typeof SituacaoDoWhatsapp>;

// O que a Meta manda pelo webhook. Só as partes usadas; o resto é aceito e ignorado (a Meta acrescenta campos).

const Texto = Type.String({ maxLength: 8000 });

export const MensagemDaMeta = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  /** O número de quem mandou, só dígitos (wa_id). */
  from: Type.String({ pattern: "^[0-9]{6,20}$" }),
  timestamp: Type.Optional(Type.String({ maxLength: 20 })),
  type: Type.String({ maxLength: 40 }),
  text: Type.Optional(Type.Object({ body: Texto })),
  /** O toque num botão de resposta (as aprovações). */
  interactive: Type.Optional(
    Type.Object({
      type: Type.String({ maxLength: 40 }),
      button_reply: Type.Optional(
        Type.Object({ id: Type.String({ maxLength: 256 }), title: Type.String({ maxLength: 40 }) }),
      ),
    }),
  ),
  /** A resposta rápida de um modelo (o botão de um modelo aprovado). */
  button: Type.Optional(
    Type.Object({ payload: Type.Optional(Type.String({ maxLength: 256 })), text: Texto }),
  ),
});
export type MensagemDaMeta = Static<typeof MensagemDaMeta>;

export const AvisoDaMeta = Type.Object({
  object: Type.String({ maxLength: 60 }),
  entry: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ maxLength: 60 })),
      changes: Type.Array(
        Type.Object({
          field: Type.String({ maxLength: 60 }),
          value: Type.Object({
            metadata: Type.Optional(Type.Object({ phone_number_id: Type.String({ maxLength: 60 }) })),
            contacts: Type.Optional(
              Type.Array(
                Type.Object({
                  wa_id: Type.Optional(Type.String({ maxLength: 20 })),
                  profile: Type.Optional(
                    Type.Object({ name: Type.Optional(Type.String({ maxLength: 200 })) }),
                  ),
                }),
                { maxItems: 20 },
              ),
            ),
            messages: Type.Optional(Type.Array(MensagemDaMeta, { maxItems: 50 })),
          }),
        }),
        { maxItems: 50 },
      ),
    }),
    { maxItems: 50 },
  ),
});
export type AvisoDaMeta = Static<typeof AvisoDaMeta>;

/** As palavras que valem como comando (sem barra, em qualquer caixa). */
export const COMANDOS_DO_WHATSAPP = [
  { comando: "nova", descricao: "começar uma conversa nova com o coordenador" },
  { comando: "tarefas", descricao: "ver as prioridades de hoje" },
  { comando: "empresa", descricao: "trocar a empresa desta conversa" },
  { comando: "sair", descricao: "desvincular este WhatsApp do Mago OS" },
  { comando: "ajuda", descricao: "como usar o Mago OS pelo WhatsApp" },
] as const;

/** Respostas fixas do WhatsApp (nenhuma diz se o número ou o código existem). */
export const RESPOSTAS_DO_WHATSAPP = {
  semVinculo: "Para usar o Mago OS pelo WhatsApp, vincule o número em Meu perfil, no app.",
  codigoInvalido: "Esse código não vale. Gere um novo em Meu perfil, no app (ele vale 10 minutos).",
  travado: "Muitos códigos errados. Espere 15 minutos e gere um código novo em Meu perfil.",
  desvinculado: "Pronto, este WhatsApp não está mais ligado ao Mago OS.",
  soTexto: "Por aqui, por enquanto, só texto: mande o arquivo pelo app ou pelo Telegram.",
  semAutenticador:
    "Você não usa app autenticador, então este pedido se aprova só no app. Recusar dá para fazer por aqui.",
  aprovacoesTravadas:
    "Muitos códigos errados. As aprovações pelo WhatsApp e pelo Telegram ficam travadas por 15 minutos. Aprove pelo app, se precisar.",
  foraDoTempo: "O tempo para mandar o código acabou. Toque em Aprovar de novo.",
} as const;

/** Toque em Aprovar pelo WhatsApp: o código fica no chat (a Meta não deixa apagar), mas vale uma vez e por 30 segundos. */
export const respostaPedindoCodigoNoWhatsapp = (resumo: string) =>
  `Para aprovar "${resumo}", mande agora o código de 6 dígitos do seu app autenticador. Ele vale por 5 minutos e só uma vez.`;

/** Ações de auditoria. */
export const ACOES_WHATSAPP = [
  "whatsapp.vinculou",
  "whatsapp.desvinculou",
  "whatsapp.trocou_empresa",
  "whatsapp.codigo_errado",
] as const;
