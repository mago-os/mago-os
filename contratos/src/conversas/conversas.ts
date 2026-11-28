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

/** O modo do agente no canal (decisão 3 da spec do M8): começa em "sugere". */
export const MODOS_DO_CANAL = ["so_pessoas", "sugere", "sozinho"] as const;
export const ModoDoCanal = Type.Enum(MODOS_DO_CANAL, {
  description: "so_pessoas (o agente não responde), sugere (a pessoa envia) ou sozinho (o agente responde).",
});
export type ModoDoCanal = Static<typeof ModoDoCanal>;

const Hora = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "HH:MM." });
/** O horário de atendimento: os dias (1 = segunda ... 7 = domingo), o início e o fim, no fuso da empresa. */
export const HorarioDoCanal = Type.Object(
  {
    dias: Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), { maxItems: 7, uniqueItems: true }),
    inicio: Hora,
    fim: Hora,
  },
  { additionalProperties: false },
);
export type HorarioDoCanal = Static<typeof HorarioDoCanal>;

/**
 * Por que o atendimento passou para uma pessoa (M8-06, decisão 0056): pediu_pessoa, irritado, repetiu (a mesma
 * pergunta pela segunda vez), em_circulos (a conversa não anda), nao_soube (o agente não sabe responder) ou
 * assunto_do_canal (um dos assuntos que sempre vão para uma pessoa).
 */
export const MOTIVOS_DA_PASSAGEM = [
  "pediu_pessoa",
  "irritado",
  "repetiu",
  "em_circulos",
  "nao_soube",
  "assunto_do_canal",
] as const;
export const MotivoDaPassagem = Type.Enum(MOTIVOS_DA_PASSAGEM, {
  description:
    "pediu_pessoa, irritado, repetiu (a mesma pergunta de novo), em_circulos, nao_soube ou assunto_do_canal.",
});
export type MotivoDaPassagem = Static<typeof MotivoDaPassagem>;

/** Os assuntos que sempre vão para uma pessoa, por canal (até 20, de até 60 letras). */
export const AssuntosParaPessoas = Type.Array(Texto(60, "Um assunto, ex.: desconto."), {
  maxItems: 20,
  uniqueItems: true,
});

/** O balão do site (M8-07, decisão 0057). */
export const ChaveDoBalao = Type.String({
  pattern: "^[A-Za-z0-9]{22}$",
  description: "A chave pública do balão.",
});
/** Os endereços onde o balão abre: https, exatos (o subdomínio por inteiro), até 10. */
export const DominiosDoBalao = Type.Array(
  Type.String({
    pattern: "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?$",
    maxLength: 253,
  }),
  { maxItems: 10, uniqueItems: true },
);
export const CorDoBalao = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
export const PosicaoDoBalao = Type.Enum(["direita", "esquerda"] as const);
export const LinkDaPolitica = Type.String({ pattern: "^https://", maxLength: 500 });

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
    /** O agente no canal (M8-05): so_pessoas, sugere (a pessoa envia) ou sozinho. */
    modo: Type.Optional(ModoDoCanal),
    instrucoes: Type.Optional(OuNulo(Type.String({ maxLength: 8000 }))),
    horario: Type.Optional(HorarioDoCanal),
    mensagemForaDoHorario: Type.Optional(Texto(1000, "O texto que sai fora do horário.")),
    limiteDeAutonomia: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    sugestoesSemEdicao: Type.Optional(Type.Integer({ minimum: 0 })),
    /** A passagem para uma pessoa (M8-06). */
    assuntosParaPessoas: Type.Optional(AssuntosParaPessoas),
    /** Minutos para alguém assumir antes de o gestor ser avisado. */
    prazoParaAssumir: Type.Optional(Type.Integer({ minimum: 1, maximum: 240 })),
    mensagemDePassagem: Type.Optional(
      Texto(1000, "O texto que sai ao contato quando o agente passa a conversa."),
    ),
    /** Com uma pessoa na conversa, o agente escreve sugestões na caixa. */
    sugerirComPessoa: Type.Optional(Type.Boolean()),
    /** O balão do site (M8-07): a chave da linha de código e a aparência. */
    chavePublica: Type.Optional(OuNulo(ChaveDoBalao)),
    dominios: Type.Optional(DominiosDoBalao),
    cor: Type.Optional(CorDoBalao),
    posicao: Type.Optional(PosicaoDoBalao),
    boasVindas: Type.Optional(Texto(500, "A mensagem de boas-vindas do balão.")),
    politicaUrl: Type.Optional(OuNulo(LinkDaPolitica)),
    whatsappCanalId: Type.Optional(OuNulo(Id)),
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
    /** O contato que já tem o e-mail ou o telefone que o cliente deixou (M8-07): a equipe confere e troca. */
    podeSerContatoId: Type.Optional(OuNulo(Id)),
    /** Quando o agente passou a conversa para uma pessoa (M8-06), com o motivo e o resumo; nula sem passagem. */
    passagem: Type.Optional(
      OuNulo(
        Type.Object(
          {
            em: DataHora,
            motivo: MotivoDaPassagem,
            resumo: OuNulo(Type.String({ maxLength: 2000 })),
            escaladaEm: OuNulo(DataHora),
          },
          { additionalProperties: false },
        ),
      ),
    ),
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

/**
 * O arquivo de uma mensagem (M8-03, decisão 0053): disponivel (passou pelo antivírus), bloqueado (pelo antivírus),
 * grande_demais (mais de 25 MB), nao_baixado (a Evolution não entregou) ou apagado (passou o prazo de 180 dias).
 */
export const SITUACOES_DO_ARQUIVO_DA_CONVERSA = [
  "disponivel",
  "bloqueado",
  "grande_demais",
  "nao_baixado",
  "apagado",
] as const;
export const ArquivoDaMensagem = Type.Object(
  {
    id: Id,
    nome: Type.String({ minLength: 1, maxLength: 200 }),
    tipo: Type.String({ maxLength: 120 }),
    tamanho: OuNulo(Type.Integer({ minimum: 1 })),
    situacao: Type.Enum(SITUACOES_DO_ARQUIVO_DA_CONVERSA),
  },
  { additionalProperties: false },
);
export type ArquivoDaMensagem = Static<typeof ArquivoDaMensagem>;

/**
 * A transcrição do áudio que chegou (M8-08, decisão 0058): transcrevendo, pronta, sem_conta (a empresa não escolheu
 * quem transcreve), longa_demais (mais de 10 minutos ou 25 MB), no_teto (o gasto do mês chegou ao teto) ou falhou.
 */
export const SITUACOES_DA_TRANSCRICAO = [
  "transcrevendo",
  "pronta",
  "sem_conta",
  "longa_demais",
  "no_teto",
  "falhou",
] as const;
export const SituacaoDaTranscricao = Type.Enum(SITUACOES_DA_TRANSCRICAO);
export type SituacaoDaTranscricao = Static<typeof SituacaoDaTranscricao>;

/** No balão do site (M8-07): a página onde o visitante escreveu, sem o que vem depois do "?" e do "#". */
export const PaginaDoSite = Type.Object(
  {
    url: Type.String({ maxLength: 500, pattern: "^https?://" }),
    titulo: OuNulo(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type PaginaDoSite = Static<typeof PaginaDoSite>;

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
    /** Foto, documento ou áudio (M8-03). */
    arquivo: OuNulo(ArquivoDaMensagem),
    /** No balão do site (M8-07): a página onde o visitante escreveu. */
    pagina: Type.Optional(OuNulo(PaginaDoSite)),
    /** No áudio que chegou (M8-08): a transcrição e a situação dela. */
    transcricao: Type.Optional(
      OuNulo(
        Type.Object(
          { situacao: SituacaoDaTranscricao, texto: OuNulo(Type.String({ maxLength: 20000 })) },
          { additionalProperties: false },
        ),
      ),
    ),
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
    /** No nome e no telefone do contato e no texto das mensagens, sem acento e aceitando erro de digitação (M8-04). */
    texto: Type.Optional(Type.String({ minLength: 2, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type FiltroDeConversas = Static<typeof FiltroDeConversas>;

// Caixa única (M8-04, decisão 0054) ---------------------------------------------------------------------------------

/** Visão da caixa salva por uma pessoa, só dela (como as dos contatos). */
export const VisaoDeConversas = Type.Object(
  {
    id: Id,
    empresaId: Id,
    pessoaId: Id,
    nome: Texto(80, "Nome da visão (ex.: Comercial sem dono)."),
    filtro: FiltroDeConversas,
    criadaEm: DataHora,
  },
  { additionalProperties: false },
);
export type VisaoDeConversas = Static<typeof VisaoDeConversas>;

export const PedidoDeVisaoDeConversas = Type.Object(
  { nome: Texto(80, "Nome da visão."), filtro: FiltroDeConversas },
  { additionalProperties: false },
);
export type PedidoDeVisaoDeConversas = Static<typeof PedidoDeVisaoDeConversas>;

/** O atalho da resposta pronta (depois da barra): minúsculas, números, _ ou -. */
const NomeDaRespostaPronta = Type.String({
  pattern: "^[a-z0-9][a-z0-9_-]{0,39}$",
  description: "O atalho, sem a barra (ex.: horario).",
});

/** Resposta pronta da empresa: na caixa, "/" e o atalho trazem o texto. */
export const RespostaPronta = Type.Object(
  { id: Id, nome: NomeDaRespostaPronta, texto: Texto(4096, "O texto da resposta.") },
  { additionalProperties: false },
);
export type RespostaPronta = Static<typeof RespostaPronta>;

export const PedidoDeRespostaPronta = Type.Object(
  { nome: NomeDaRespostaPronta, texto: Texto(4096, "O texto da resposta.") },
  { additionalProperties: false },
);
export type PedidoDeRespostaPronta = Static<typeof PedidoDeRespostaPronta>;

/** Passar a conversa para outra pessoa da empresa (que veja as conversas do canal). */
export const PedidoDePassarConversa = Type.Object({ pessoaId: Id }, { additionalProperties: false });
export type PedidoDePassarConversa = Static<typeof PedidoDePassarConversa>;

/** Nota interna: só a equipe vê; as pessoas chamadas com @ recebem um aviso. */
export const PedidoDeNotaNaConversa = Type.Object(
  {
    texto: Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" }),
    mencoes: Type.Optional(Type.Array(Id, { maxItems: 10, uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type PedidoDeNotaNaConversa = Static<typeof PedidoDeNotaNaConversa>;

/** O que o agente sugere responder no modo "sugere" (M8-05): a pessoa envia, edita ou descarta. */
export const SugestaoDeResposta = Type.Object(
  {
    id: Id,
    conversaId: Id,
    agenteId: OuNulo(Id),
    texto: Texto(4096, "O texto sugerido."),
    criadaEm: DataHora,
  },
  { additionalProperties: false },
);
export type SugestaoDeResposta = Static<typeof SugestaoDeResposta>;

/** Enviar a sugestão: sem texto, vai como o agente escreveu; com texto diferente, conta como editada. */
export const PedidoDeEnviarSugestao = Type.Object(
  { texto: Type.Optional(Texto(4096, "O texto que vai, se a pessoa mudou.")) },
  { additionalProperties: false },
);
export type PedidoDeEnviarSugestao = Static<typeof PedidoDeEnviarSugestao>;

/** Minutos entre dois avisos de mensagem nova da mesma conversa ao dono. */
export const MINUTOS_ENTRE_AVISOS_DA_CONVERSA = 5;

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
    /** Mandada pelo próprio número, direto no celular (M8-03): entra como "saiu", marcada "pelo celular". */
    doCelular: Type.Optional(Type.Boolean()),
    /** No balão do site (M8-07): a página onde o visitante escreveu. */
    pagina: Type.Optional(PaginaDoSite),
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

/** O maior arquivo de uma conversa: o mesmo dos anexos (25 MB). */
export const TAMANHO_MAXIMO_DO_ARQUIVO_DA_CONVERSA = 25 * 1024 * 1024;
/** Entre duas mensagens para o mesmo contato, pelo menos este tempo (ritmo de envio, decisão 0053). */
export const SEGUNDOS_ENTRE_MENSAGENS_AO_CONTATO = 3;

/** Mandar uma mensagem na conversa (M8-03): texto, ou um arquivo (foto ou documento) com a legenda opcional. */
export const PedidoDeMensagemNaConversa = Type.Object(
  {
    texto: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" })),
    arquivo: Type.Optional(
      Type.Object(
        {
          nome: Texto(200, "Nome do arquivo."),
          tipo: Type.String({ pattern: "^[a-z0-9.+-]+/[a-z0-9.+-]+$", maxLength: 120 }),
          /** O arquivo em base64 (até 25 MB). */
          base64: Type.String({ minLength: 4, maxLength: 35_000_000, pattern: "^[A-Za-z0-9+/]+={0,2}$" }),
        },
        { additionalProperties: false },
      ),
    ),
    /** O arquivo é um áudio gravado na caixa (M8-08): sai como mensagem de voz do WhatsApp (até 5 minutos). */
    voz: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeMensagemNaConversa = Static<typeof PedidoDeMensagemNaConversa>;

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
  // M8-03: uma pessoa mandou uma mensagem a um contato (só ids, nunca o texto) e mandou de novo a que falhou.
  "conversa.enviou",
  "conversa.reenviou",
  // M8-04: a nota interna (só ids) e as respostas prontas.
  "conversa.anotou",
  "resposta_pronta.criou",
  "resposta_pronta.editou",
  "resposta_pronta.apagou",
  // M8-05: a sugestão do agente enviada (sem ou com edição) ou descartada, e o agente de atendimento criado no canal.
  "sugestao.enviou",
  "sugestao.descartou",
  "canal.criou_atendente",
  // M8-08: alguém pediu para transcrever de novo um áudio.
  "conversa.transcreveu",
] as const;
export type AcaoDasConversas = (typeof ACOES_CONVERSAS)[number];

// Canais de WhatsApp pela Evolution API (M8-02, decisão 0052) -----------------------------------------------------

/** Conectar um número de WhatsApp pela Evolution: o nome do canal e a equipe que atende (nula: todos veem). */
export const PedidoDeCanalDeWhatsapp = Type.Object(
  { nome: Texto(80, "Nome do canal (ex.: WhatsApp comercial)."), area: Type.Optional(OuNulo(Area)) },
  { additionalProperties: false },
);
export type PedidoDeCanalDeWhatsapp = Static<typeof PedidoDeCanalDeWhatsapp>;

/** Mudar o nome ou a equipe do canal (só o que veio muda). */
export const PedidoDeEditarCanal = Type.Object(
  {
    nome: Type.Optional(Texto(80, "Nome do canal.")),
    area: Type.Optional(OuNulo(Area)),
    // O agente no canal (M8-05, só o administrador).
    agenteId: Type.Optional(OuNulo(Id)),
    modo: Type.Optional(ModoDoCanal),
    instrucoes: Type.Optional(OuNulo(Type.String({ maxLength: 8000 }))),
    horario: Type.Optional(HorarioDoCanal),
    mensagemForaDoHorario: Type.Optional(Texto(1000, "O texto que sai fora do horário.")),
    limiteDeAutonomia: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    // A passagem para uma pessoa (M8-06).
    assuntosParaPessoas: Type.Optional(AssuntosParaPessoas),
    prazoParaAssumir: Type.Optional(Type.Integer({ minimum: 1, maximum: 240 })),
    mensagemDePassagem: Type.Optional(Texto(1000, "O texto que sai ao contato na passagem.")),
    sugerirComPessoa: Type.Optional(Type.Boolean()),
    // O balão do site (M8-07).
    dominios: Type.Optional(DominiosDoBalao),
    cor: Type.Optional(CorDoBalao),
    posicao: Type.Optional(PosicaoDoBalao),
    boasVindas: Type.Optional(Texto(500, "A mensagem de boas-vindas do balão.")),
    politicaUrl: Type.Optional(OuNulo(LinkDaPolitica)),
    whatsappCanalId: Type.Optional(OuNulo(Id)),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarCanal = Static<typeof PedidoDeEditarCanal>;

/** Criar o balão do site (M8-07): o nome, a equipe, os domínios e o link da política de privacidade. */
export const PedidoDeCanalDoSite = Type.Object(
  {
    nome: Texto(80, "Nome do canal (ex.: Chat do site)."),
    area: Type.Optional(OuNulo(Area)),
    dominios: DominiosDoBalao,
    politicaUrl: LinkDaPolitica,
  },
  { additionalProperties: false },
);
export type PedidoDeCanalDoSite = Static<typeof PedidoDeCanalDoSite>;

/** O QR code para ler no celular, enquanto o número não conectou (imagem PNG em data URL). */
export const QrDoCanal = Type.Object(
  {
    situacao: SituacaoDeCanal,
    /** Nulo quando já conectou (ou a Evolution ainda não gerou). */
    qr: OuNulo(Type.String({ pattern: "^data:image/png;base64,[A-Za-z0-9+/=]+$", maxLength: 200000 })),
    identificador: OuNulo(TelefoneDoCanal),
  },
  { additionalProperties: false },
);
export type QrDoCanal = Static<typeof QrDoCanal>;

/**
 * O aviso que a Evolution manda ao núcleo pela rede interna (webhook da instância). Só o formato de fora é conferido
 * aqui; o "data" de cada evento é lido com cuidado pelo núcleo (a Evolution não é nossa).
 */
export const AvisoDaEvolution = Type.Object(
  {
    event: Type.String({ minLength: 1, maxLength: 80 }),
    instance: Type.String({ minLength: 1, maxLength: 120 }),
    data: Type.Optional(Type.Unknown()),
  },
  { description: "Aviso de uma instância da Evolution API." },
);
export type AvisoDaEvolution = Static<typeof AvisoDaEvolution>;

/** O aviso de risco e o de uso (condição da licença da Evolution API), na tela de canais. */
export const AVISO_DE_RISCO_DA_EVOLUTION =
  "A conexão pela Evolution API não é oficial do WhatsApp. O WhatsApp pode bloquear o número, principalmente com envio em volume ou para quem não autorizou. Use um número que possa correr esse risco.";
export const AVISO_DE_USO_DA_EVOLUTION =
  "Conexão de WhatsApp pela Evolution API (código aberto, evolution-api).";
