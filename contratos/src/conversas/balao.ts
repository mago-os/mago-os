/**
 * O balão do site (M8-07, decisão 0057): o que as rotas públicas do balão recebem e devolvem. Sem login: o balão se
 * identifica pela chave pública do canal, e o visitante pelo código que o navegador guarda (30 dias). O visitante só
 * vê a própria conversa: o que a equipe escreveu e as notas internas nunca se misturam (nota interna não sai).
 */
import { type Static, Type } from "typebox";
import { DataHora, Id, OuNulo, Texto } from "../comum.ts";
import { CorDoBalao, PaginaDoSite, PosicaoDoBalao } from "./conversas.ts";

/** O maior texto que o visitante manda de uma vez. */
export const LETRAS_DA_MENSAGEM_DO_BALAO = 1000;

/** O que o balão mostra antes da primeira mensagem. */
export const ConfiguracaoDoBalao = Type.Object(
  {
    nome: Texto(80, "O nome do canal."),
    cor: CorDoBalao,
    posicao: PosicaoDoBalao,
    boasVindas: Texto(500, "A mensagem de boas-vindas."),
    politicaUrl: Type.String({ maxLength: 500 }),
    /** Mostra "continuar no WhatsApp". */
    whatsapp: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ConfiguracaoDoBalao = Static<typeof ConfiguracaoDoBalao>;

/** A prova de trabalho: achar um número que, junto com o desafio, dê um SHA-256 com os primeiros bits zerados. */
export const DesafioDoBalao = Type.Object(
  {
    desafio: Type.String({ maxLength: 300 }),
    /** Quantos bits do começo do SHA-256 precisam ser zero. */
    dificuldade: Type.Integer({ minimum: 1, maximum: 24 }),
  },
  { additionalProperties: false },
);
export type DesafioDoBalao = Static<typeof DesafioDoBalao>;

/** Entrar como visitante: o desafio resolvido e o campo escondido (as pessoas não preenchem). */
export const PedidoDeVisitante = Type.Object(
  {
    desafio: Type.String({ maxLength: 300 }),
    resposta: Type.String({ pattern: "^[0-9]{1,12}$" }),
    site: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type PedidoDeVisitante = Static<typeof PedidoDeVisitante>;

/** O código do visitante (o navegador guarda; o banco só o resumo). */
export const VisitanteDoBalao = Type.Object(
  { codigo: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }), venceEm: DataHora },
  { additionalProperties: false },
);
export type VisitanteDoBalao = Static<typeof VisitanteDoBalao>;

/** O visitante escreve: só texto, até 1.000 letras, com a página onde está. */
export const PedidoDeMensagemDoBalao = Type.Object(
  {
    texto: Type.String({ minLength: 1, maxLength: LETRAS_DA_MENSAGEM_DO_BALAO }),
    pagina: Type.Optional(PaginaDoSite),
  },
  { additionalProperties: false },
);
export type PedidoDeMensagemDoBalao = Static<typeof PedidoDeMensagemDoBalao>;

/** Uma mensagem como o visitante vê: dele ou da empresa (com o nome de quem escreveu). */
export const MensagemDoBalao = Type.Object(
  {
    id: Id,
    de: Type.Enum(["visitante", "empresa"] as const),
    nome: OuNulo(Type.String({ maxLength: 200 })),
    texto: Type.String({ maxLength: 20000 }),
    enviadaEm: DataHora,
  },
  { additionalProperties: false },
);
export type MensagemDoBalao = Static<typeof MensagemDoBalao>;

/** "Continuar no WhatsApp": o link do wa.me com a mensagem pronta e o código (30 minutos, uso único). */
export const ContinuarNoWhatsapp = Type.Object(
  {
    link: Type.String({ maxLength: 500 }),
    codigo: Type.String({ pattern: "^[A-HJ-NP-Z2-9]{6}$" }),
    venceEm: DataHora,
  },
  { additionalProperties: false },
);
export type ContinuarNoWhatsapp = Static<typeof ContinuarNoWhatsapp>;
