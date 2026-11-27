/**
 * Conversas com contatos (M8-01, decisão 0051): os canais da empresa (um número de WhatsApp, um balão de site), as
 * conversas e as mensagens, ligadas ao contato do M7. Separadas das conversas da pessoa com o coordenador (decisão 1
 * da spec do M8): estas são da empresa, e a equipe do canal vê.
 *
 * Regras aprovadas pelo Sandro em 27/11/2026:
 * - Uma só conversa não resolvida por contato em cada canal: a mensagem que chega continua essa.
 * - Resolvida não reabre sozinha: uma mensagem nova abre outra conversa. Na folga de 1 hora depois de resolver, a
 *   mensagem ainda cai na conversa resolvida, sem reabri-la (o "obrigado" do cliente não abre conversa nova).
 * - O texto do contato é sempre texto de outros para os agentes (M4-04): é dado, nunca ordem.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { Area } from "../identidade/vinculo.ts";

/** evolution (WhatsApp pela Evolution API), meta (WhatsApp oficial) ou site (o balão do chat no site). */
export const PROVEDORES_DE_CANAL = ["evolution", "meta", "site"] as const;
export const ProvedorDeCanal = Type.Enum(PROVEDORES_DE_CANAL, {
  description: "evolution (WhatsApp pela Evolution API), meta (WhatsApp oficial) ou site (balão do site).",
});
export type ProvedorDeCanal = Static<typeof ProvedorDeCanal>;

export const SITUACOES_DE_CANAL = ["esperando_conexao", "conectado", "desconectado", "pausado"] as const;
export const SituacaoDeCanal = Type.Enum(SITUACOES_DE_CANAL);
export type SituacaoDeCanal = Static<typeof SituacaoDeCanal>;

/** Telefone no formato internacional (E.164), como nos contatos. */
const TelefoneDoCanal = Type.String({
  pattern: "^\\+[1-9][0-9]{7,14}$",
  description: "O número conectado, no formato internacional (ex.: +5511987654321).",
});

/** Um canal da empresa. A configuração do provedor não sai daqui (e nunca tem segredo). */
export const Canal = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: Texto(80, "Nome do canal (ex.: WhatsApp comercial)."),
    provedor: ProvedorDeCanal,
    situacao: SituacaoDeCanal,
    /** O número conectado (no balão do site, nulo). */
    identificador: OuNulo(TelefoneDoCanal),
    /** A equipe que atende (a área das pessoas). Nula: todos os funcionários veem as conversas do canal. */
    area: OuNulo(Area),
    agenteId: OuNulo(Id),
    criadoEm: DataHora,
  },
  {
    additionalProperties: false,
    description: "Canal de conversa da empresa: um número de WhatsApp ou um balão.",
  },
);
export type Canal = Static<typeof Canal>;

/** O canal como aparece numa conversa. */
export const CanalNaConversa = Type.Object(
  { id: Id, nome: Texto(80, "Nome do canal."), provedor: ProvedorDeCanal, situacao: SituacaoDeCanal },
  { additionalProperties: false },
);
export type CanalNaConversa = Static<typeof CanalNaConversa>;

/**
 * aberta; esperando_cliente (a equipe ou o agente respondeu); esperando_equipe (o contato escreveu ou pediu uma
 * pessoa); resolvida (não reabre sozinha).
 */
export const SITUACOES_DE_CONVERSA = [
  "aberta",
  "esperando_cliente",
  "esperando_equipe",
  "resolvida",
] as const;
export const SituacaoDeConversa = Type.Enum(SITUACOES_DE_CONVERSA);
export type SituacaoDeConversa = Static<typeof SituacaoDeConversa>;

export const QUEM_ESCREVE = ["contato", "agente", "pessoa", "sistema"] as const;
export const QuemEscreve = Type.Enum(QUEM_ESCREVE, {
  description: "contato, agente, pessoa da equipe ou sistema.",
});
export type QuemEscreve = Static<typeof QuemEscreve>;

/** A conversa da empresa com um contato, num canal. */
export const ConversaComContato = Type.Object(
  {
    id: Id,
    empresaId: Id,
    canal: CanalNaConversa,
    contatoId: Id,
    contatoNome: Texto(200, "Nome do contato."),
    /** Falso no contato criado sozinho pela conversa, até alguém confirmar o nome. */
    contatoIdentificado: Type.Boolean(),
    /** Por onde o contato fala: o telefone ou o visitante do site. */
    identificador: Texto(120, "O telefone ou o visitante do site."),
    /** O telefone está em mais de um contato: a tela avisa e deixa trocar. */
    maisDeUmContato: Type.Boolean(),
    /** A pessoa da equipe que cuida (nula: com o agente ou sem dono). */
    donoId: OuNulo(Id),
    comAgente: Type.Boolean(),
    situacao: SituacaoDeConversa,
    ultimoAResponder: OuNulo(Type.Enum(["contato", "agente", "pessoa"] as const)),
    ultimaMensagemEm: OuNulo(DataHora),
    abertaEm: DataHora,
    resolvidaEm: OuNulo(DataHora),
    resolvidaPor: OuNulo(Id),
  },
  { additionalProperties: false, description: "Conversa da empresa com um contato, num canal." },
);
export type ConversaComContato = Static<typeof ConversaComContato>;

export const TIPOS_DE_MENSAGEM = [
  "texto",
  "foto",
  "documento",
  "audio",
  "localizacao",
  "contato",
  "outro",
  "nota",
] as const;
export const TipoDeMensagem = Type.Enum(TIPOS_DE_MENSAGEM, {
  description:
    "texto, foto, documento, audio, localizacao, contato, outro (ainda não mostrado aqui) ou nota.",
});
export type TipoDeMensagem = Static<typeof TipoDeMensagem>;

export const SITUACOES_DE_ENTREGA = ["pendente", "enviada", "entregue", "lida", "falhou"] as const;
export const SituacaoDeEntrega = Type.Enum(SITUACOES_DE_ENTREGA);
export type SituacaoDeEntrega = Static<typeof SituacaoDeEntrega>;

/** Uma mensagem da conversa: chegou do contato, saiu da empresa, ou a nota interna (só a equipe vê). */
export const MensagemDaConversa = Type.Object(
  {
    id: Id,
    conversaId: Id,
    direcao: Type.Enum(["chegou", "saiu", "interna"] as const),
    autor: QuemEscreve,
    autorPessoaId: OuNulo(Id),
    autorAgenteId: OuNulo(Id),
    tipo: TipoDeMensagem,
    texto: OuNulo(Type.String({ maxLength: 20000 })),
    enviadaEm: DataHora,
    /** Alguém respondeu direto no celular do número. */
    peloCelular: Type.Boolean(),
    /** No que sai. */
    entrega: OuNulo(SituacaoDeEntrega),
    motivoDaFalha: OuNulo(Type.String({ maxLength: 300 })),
  },
  { additionalProperties: false },
);
export type MensagemDaConversa = Static<typeof MensagemDaConversa>;

/** A conversa na lista e na linha do tempo do contato: com o começo da última mensagem (sem as notas internas). */
export const ResumoDaConversa = Type.Object(
  {
    conversa: ConversaComContato,
    ultimaMensagem: OuNulo(
      Type.Object(
        {
          autor: QuemEscreve,
          tipo: TipoDeMensagem,
          /** Até 140 caracteres. */
          trecho: OuNulo(Type.String({ maxLength: 140 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ResumoDaConversa = Static<typeof ResumoDaConversa>;

/** Filtro da lista de conversas. */
export const FiltroDeConversas = Type.Object(
  {
    situacoes: Type.Optional(Type.Array(SituacaoDeConversa, { minItems: 1, uniqueItems: true })),
    canalId: Type.Optional(Id),
    contatoId: Type.Optional(Id),
    /** A pessoa dona; "sem" para as conversas sem dono. */
    donoId: Type.Optional(Type.Union([Id, Type.Literal("sem")])),
    comAgente: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type FiltroDeConversas = Static<typeof FiltroDeConversas>;

/** Ligar a conversa a outro contato (o telefone está em mais de um contato, decisão 0051 item 2). */
export const PedidoDeTrocarContato = Type.Object({ contatoId: Id }, { additionalProperties: false });
export type PedidoDeTrocarContato = Static<typeof PedidoDeTrocarContato>;

/**
 * O que um provedor (Evolution, Meta, o balão do site) entrega quando chega uma mensagem do contato. É a fronteira
 * entre o provedor e o núcleo: o núcleo acha o contato, abre ou continua a conversa e grava sem repetir.
 */
export const MensagemQueChegou = Type.Object(
  {
    canalId: Id,
    /** O telefone no formato internacional (WhatsApp) ou o visitante do site ("visitante:<id>"). */
    identificador: Type.String({ minLength: 1, maxLength: 120 }),
    /** O nome do perfil do WhatsApp (só para o contato novo). */
    nomeDoPerfil: Type.Optional(OuNulo(Type.String({ maxLength: 200 }))),
    idNoProvedor: Type.Optional(OuNulo(Type.String({ minLength: 1, maxLength: 200 }))),
    tipo: Type.Enum(["texto", "foto", "documento", "audio", "localizacao", "contato", "outro"] as const),
    texto: Type.Optional(OuNulo(Type.String({ maxLength: 20000 }))),
    /** A hora que o provedor informa (sem ela, agora). */
    enviadaEm: Type.Optional(DataHora),
  },
  { additionalProperties: false },
);
export type MensagemQueChegou = Static<typeof MensagemQueChegou>;

export function conferirMensagemQueChegou(valor: unknown) {
  return conferir(MensagemQueChegou, valor, [
    (m): Problema[] =>
      m.tipo === "texto" && !m.texto?.trim()
        ? [{ caminho: "/texto", mensagem: "mensagem de texto vazia" }]
        : [],
  ]);
}

/** Folga depois de resolver: a mensagem que chega nesse tempo cai na conversa resolvida, sem reabrir. */
export const MINUTOS_DE_FOLGA_DEPOIS_DE_RESOLVER = 60;

/** Ações de auditoria dos canais e das conversas. Nos detalhes vão só ids, nunca o texto das mensagens. */
export const ACOES_CONVERSAS = [
  "canal.criou",
  "canal.editou",
  "canal.conectou",
  "canal.desconectou",
  "canal.apagou",
  "conversa.assumiu",
  "conversa.passou",
  "conversa.devolveu",
  "conversa.resolveu",
  "conversa.reabriu",
  "conversa.trocou_contato",
  "conversa.apagou",
] as const;
export type AcaoDasConversas = (typeof ACOES_CONVERSAS)[number];
