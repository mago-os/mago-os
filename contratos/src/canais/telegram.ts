/**
 * Telegram (M5-01, decisão 0032): o bot do Mago OS e o vínculo de uma conta do Telegram a uma pessoa.
 *
 * Um bot só para a plataforma toda (e outro só para o ambiente de testes). O Telegram entrega cada mensagem por
 * webhook, conferido pelo cabeçalho secreto. A pessoa gera em Meu perfil um código de uso único (10 minutos) e abre
 * o bot por um link que já leva o código. Uma conta do Telegram fica ligada a uma pessoa só, e uma pessoa tem uma
 * conta do Telegram só. A conversa vale para a empresa em que o código foi gerado; quem está em mais de uma troca
 * com /empresa. Só conversa individual com o bot: grupo, canal ou conta sem vínculo recebe só a resposta fixa.
 *
 * O token do bot e o segredo do webhook ficam no Infisical, nunca no banco nem na tela.
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo } from "../comum.ts";

/** O código vale 10 minutos e serve uma vez só. */
export const MINUTOS_DO_CODIGO_DO_TELEGRAM = 10;

/** Trava de códigos errados por conta do Telegram, como no login: 5 erros em 15 minutos. */
export const CODIGOS_ERRADOS_DO_TELEGRAM = 5;
export const MINUTOS_DA_TRAVA_DO_TELEGRAM = 15;

/** Mensagens por minuto de uma conta do Telegram; acima disso o bot ignora até o minuto virar. */
export const MENSAGENS_POR_MINUTO_DO_TELEGRAM = 30;

/**
 * Letras do código: sem 0, O, 1, I e L, para não confundir ao digitar. Oito letras dão 31^8 (cerca de 850 bilhões)
 * combinações; com a trava acima, adivinhar é inviável.
 */
export const LETRAS_DO_CODIGO_DO_TELEGRAM = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TAMANHO_DO_CODIGO_DO_TELEGRAM = 8;
export const FormatoDoCodigoDoTelegram = Type.String({
  pattern: `^[${LETRAS_DO_CODIGO_DO_TELEGRAM}]{${TAMANHO_DO_CODIGO_DO_TELEGRAM}}$`,
  description: "Código de vínculo: 8 letras e números, sem os que confundem.",
});

/** O que Meu perfil recebe ao gerar o código. O código só aparece aqui; o banco guarda o resumo dele. */
export const CodigoDoTelegram = Type.Object(
  {
    codigo: FormatoDoCodigoDoTelegram,
    /** Abre o bot já com o código (https://t.me/<bot>?start=<código>). */
    link: Type.String({ pattern: "^https://t\\.me/[A-Za-z0-9_]{5,32}\\?start=[A-Z0-9]+$" }),
    venceEm: DataHora,
  },
  { additionalProperties: false, description: "Código de uso único para vincular o Telegram." },
);
export type CodigoDoTelegram = Static<typeof CodigoDoTelegram>;

/** O vínculo como Meu perfil mostra (sem os números internos do Telegram). */
export const VinculoDoTelegram = Type.Object(
  {
    /** O @usuário no Telegram, se a pessoa tiver. */
    usuario: OuNulo(Type.String({ maxLength: 64 })),
    /** O nome que a pessoa usa no Telegram. */
    nome: Type.String({ maxLength: 200 }),
    /** A empresa em que a conversa pelo Telegram acontece agora. */
    empresa: Type.Object({ id: Id, nome: Type.String() }, { additionalProperties: false }),
    vinculadoEm: DataHora,
  },
  { additionalProperties: false, description: "A conta do Telegram ligada a esta pessoa." },
);
export type VinculoDoTelegram = Static<typeof VinculoDoTelegram>;

/** Meu perfil › Telegram: o vínculo (ou nulo) e se o bot está ligado neste ambiente. */
export const SituacaoDoTelegram = Type.Object(
  {
    /** Falso quando o servidor não tem o token do bot (o cartão explica e não deixa gerar código). */
    botLigado: Type.Boolean(),
    /** O @ do bot, para a tela mostrar. */
    bot: OuNulo(Type.String({ maxLength: 64 })),
    vinculo: OuNulo(VinculoDoTelegram),
  },
  { additionalProperties: false },
);
export type SituacaoDoTelegram = Static<typeof SituacaoDoTelegram>;

// O que o Telegram manda pelo webhook. Só as partes que o Mago OS usa; o resto é aceito e ignorado (o Telegram
// acrescenta campos sem avisar). Números do Telegram cabem em 52 bits, então são números comuns do JavaScript.

const NumeroDoTelegram = Type.Integer({ description: "Número da conta ou do chat no Telegram." });

export const UsuarioDoTelegram = Type.Object({
  id: NumeroDoTelegram,
  is_bot: Type.Boolean(),
  first_name: Type.String(),
  last_name: Type.Optional(Type.String()),
  username: Type.Optional(Type.String()),
});
export type UsuarioDoTelegram = Static<typeof UsuarioDoTelegram>;

export const MensagemDoTelegram = Type.Object({
  message_id: Type.Integer(),
  date: Type.Integer(),
  chat: Type.Object({ id: NumeroDoTelegram, type: Type.String() }),
  from: Type.Optional(UsuarioDoTelegram),
  text: Type.Optional(Type.String()),
});
export type MensagemDoTelegram = Static<typeof MensagemDoTelegram>;

/** Uma atualização do webhook. Cada update_id é tratado uma vez só. */
export const AtualizacaoDoTelegram = Type.Object({
  update_id: Type.Integer({ minimum: 0 }),
  message: Type.Optional(MensagemDoTelegram),
});
export type AtualizacaoDoTelegram = Static<typeof AtualizacaoDoTelegram>;

// Conversa pelo Telegram (M5-02, decisão 0033).

/** O Telegram é contínuo: depois de 6 horas sem mensagem, o próximo pedido começa uma conversa nova. */
export const HORAS_PARA_CONVERSA_NOVA_NO_TELEGRAM = 6;

/** Prioridades que /tarefas mostra (as primeiras da central, com o link de cada uma). */
export const MAXIMO_DE_PRIORIDADES_NO_TELEGRAM = 10;

/** Comandos do bot, na ordem do menu do Telegram. /nova e /tarefas chegam na M5-02. */
export const COMANDOS_DO_TELEGRAM = [
  { comando: "nova", descricao: "Começar uma conversa nova com o coordenador" },
  { comando: "tarefas", descricao: "Ver as prioridades de hoje" },
  { comando: "empresa", descricao: "Trocar a empresa desta conversa" },
  { comando: "sair", descricao: "Desvincular este Telegram do Mago OS" },
  { comando: "ajuda", descricao: "Como usar o Mago OS pelo Telegram" },
] as const;

/** Respostas fixas do bot (congeladas por teste: nenhuma diz se a conta ou o código existem). */
export const RESPOSTAS_DO_TELEGRAM = {
  semVinculo: "Para usar o Mago OS pelo Telegram, vincule a conta em Meu perfil, no app.",
  codigoInvalido: "Esse código não vale. Gere um novo em Meu perfil, no app (ele vale 10 minutos).",
  travado: "Muitos códigos errados. Espere 15 minutos e gere um código novo em Meu perfil.",
  soConversaIndividual: "O Mago OS só conversa com você em particular, não em grupos.",
  desvinculado: "Pronto, este Telegram não está mais ligado ao Mago OS.",
  conversaNova: "Pronto, conversa nova. Pode mandar o pedido.",
  ocupado: "Ainda estou respondendo a mensagem anterior. Espere a resposta e mande de novo.",
  semPermissaoDeEspecialista:
    "Só o administrador e o gestor falam direto com um especialista. Mande o pedido sem a menção, para o coordenador.",
  especialistaNaoEncontrado: "Não encontrei esse agente. Mande o pedido sem a menção, para o coordenador.",
  soTexto: "Por enquanto entendo só texto por aqui. Arquivos e fotos chegam em breve.",
  semAcessoAosAgentes: "O seu perfil nesta empresa não conversa com os agentes. Fale com o administrador.",
  semPrioridades: "Nada pedindo a sua atenção agora.",
} as const;

/** Quando os agentes foram parados (M4-09) ou o agente está pausado, a resposta leva o motivo ou o nome. */
export const respostaDeAgentesParados = (motivo: string) =>
  `Os agentes foram parados por um administrador: ${motivo}`;
export const respostaDeAgentePausado = (nome: string) =>
  `${nome} está pausado agora. O administrador escolhe o modelo de IA e liga em Agentes, no app.`;

/** Ações de auditoria. */
export const ACOES_TELEGRAM = [
  "telegram.vinculou",
  "telegram.desvinculou",
  "telegram.trocou_empresa",
  "telegram.codigo_errado",
] as const;

/**
 * Menção a um especialista no começo da mensagem ("@gerente planeja o lançamento"): o nome do agente, sem acento e
 * sem diferença de maiúsculas, pelo começo de qualquer palavra do nome. Devolve o que veio depois da menção.
 */
export function mencaoNoComeco(texto: string): { mencao: string; resto: string } | null {
  const m = /^@([\p{L}\p{N}_-]{2,40})[\s,:]+([\s\S]+)$/u.exec(texto.trim());
  return m ? { mencao: m[1] as string, resto: (m[2] as string).trim() } : null;
}
