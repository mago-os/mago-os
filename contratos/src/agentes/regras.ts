/**
 * Regras por ação e aprovações (M4-03, decisão 0025). Cada ferramenta que um agente usa (interno ou externo, pelo MCP)
 * é uma ação com um modo: executa sozinho, executa só nas tarefas dele, pede aprovação ou bloqueado. O padrão vem
 * deste catálogo; o administrador ajusta por agente e por ação (o responsável do agente só deixa mais restrito).
 *
 * Quando a ação pede aprovação, o agente não executa: o núcleo guarda o pedido com os parâmetros exatos, ele aparece na
 * central de prioridades e no sino, e a ação só acontece quando alguém aprova (podendo editar antes). Vence em 24
 * horas. Antes de executar, o núcleo confere que os parâmetros são os mesmos que a pessoa viu.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/**
 * Do mais solto ao mais restrito. executa_nas_dele: executa nas tarefas que o agente pegou ou de que é responsável
 * (e nas subtarefas delas); nas outras, pede aprovação.
 */
export const MODOS_DE_ACAO = ["executa", "executa_nas_dele", "pede_aprovacao", "bloqueado"] as const;
export const ModoDeAcao = Type.Enum(MODOS_DE_ACAO, {
  description: "executa, executa_nas_dele (nas outras tarefas pede aprovação), pede_aprovacao ou bloqueado.",
});
export type ModoDeAcao = Static<typeof ModoDeAcao>;

/** Se o modo b é igual ou mais restrito que a (o responsável do agente só pode ir nessa direção). */
export function maisRestrito(a: ModoDeAcao, b: ModoDeAcao): boolean {
  return MODOS_DE_ACAO.indexOf(b) >= MODOS_DE_ACAO.indexOf(a);
}

export interface AcaoDoCatalogo {
  /** O nome da ferramenta (interna ou do MCP). */
  acao: string;
  /** Como aparece na tela. */
  nome: string;
  /** Muda dados da empresa (as que só leem ou conversam não pedem aprovação). */
  mudaDados: boolean;
  /** Padrão para os agentes internos (decisão 6 da spec do M4). */
  padraoInterno: ModoDeAcao;
  /** Padrão para os agentes externos: as ferramentas do MCP de hoje continuam executando (decisão 7). */
  padraoExterno: ModoDeAcao | null;
}

/**
 * Todas as ações que um agente pode fazer hoje. Uma ação nova (ferramenta nova) entra aqui no mesmo PR, com o
 * padrão escolhido; o teste confere que nenhuma ferramenta fica sem regra.
 */
export const CATALOGO_DE_ACOES: readonly AcaoDoCatalogo[] = [
  // Ler e conversar: executa sempre (pode ser bloqueado, nunca pede aprovação).
  {
    acao: "minhas_tarefas",
    nome: "Ver as próprias tarefas",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "ver_tarefa",
    nome: "Ver uma tarefa",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "procurar_projeto",
    nome: "Procurar projeto",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "procurar_pessoa",
    nome: "Procurar pessoa",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "listar_tarefas",
    nome: "Listar tarefas",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "minhas_prioridades",
    nome: "Ver as prioridades de quem pediu",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "buscar",
    nome: "Buscar",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  // Arquivos mandados pelo Telegram (M5-03): ver os que esperam e anexar numa tarefa que quem pediu pode editar.
  {
    acao: "arquivos_recebidos",
    nome: "Ver os arquivos recebidos pelo Telegram",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "anexar_arquivo",
    nome: "Anexar arquivo recebido pelo Telegram",
    mudaDados: true,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  // Agenda (M5-07): ver executa; marcar um evento pede aprovação (manda convite a outras pessoas).
  {
    acao: "ver_agenda",
    nome: "Ver a agenda",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "criar_evento",
    nome: "Marcar evento na agenda",
    mudaDados: true,
    padraoInterno: "pede_aprovacao",
    padraoExterno: null,
  },
  // Rotinas (M5-05): ler executa; criar e ligar pedem aprovação (a rotina age sozinha depois); parar executa.
  {
    acao: "listar_rotinas",
    nome: "Ver as rotinas",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "ver_rotina",
    nome: "Ver uma rotina",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "criar_rotina",
    nome: "Criar rotina",
    mudaDados: true,
    padraoInterno: "pede_aprovacao",
    padraoExterno: null,
  },
  {
    acao: "ligar_rotina",
    nome: "Ligar rotina",
    mudaDados: true,
    padraoInterno: "pede_aprovacao",
    padraoExterno: null,
  },
  {
    acao: "parar_rotina",
    nome: "Desligar rotina",
    mudaDados: true,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "ver_custos",
    nome: "Ver os custos",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "pegar_instrucoes",
    nome: "Ler as instruções",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "listar_skills",
    nome: "Listar as skills",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "pegar_skill",
    nome: "Ler uma skill",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "baixar_anexo",
    nome: "Baixar anexo",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "estou_vivo",
    nome: "Avisar que está vivo",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: "executa",
  },
  {
    acao: "perguntar",
    nome: "Perguntar à pessoa",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "responder",
    nome: "Responder à pessoa",
    mudaDados: false,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  // Mexer nas tarefas: comentar e criar executam; o resto, só nas tarefas do próprio agente.
  { acao: "comentar", nome: "Comentar", mudaDados: true, padraoInterno: "executa", padraoExterno: "executa" },
  {
    acao: "criar_tarefa",
    nome: "Criar tarefa",
    mudaDados: true,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  {
    acao: "pegar_tarefa",
    nome: "Pegar tarefa",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "soltar_tarefa",
    nome: "Soltar tarefa",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "mudar_status",
    nome: "Mudar status",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "entregar_resultado",
    nome: "Entregar resultado",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "criar_subtarefa",
    nome: "Criar subtarefa",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "marcar_checklist",
    nome: "Marcar checklist",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: "executa",
  },
  {
    acao: "acrescentar_checklist",
    nome: "Acrescentar ao checklist",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: null,
  },
  {
    acao: "mudar_projeto",
    nome: "Mudar o projeto da tarefa",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: null,
  },
  {
    acao: "planejar",
    nome: "Planejar (subtarefas e checklist)",
    mudaDados: true,
    padraoInterno: "executa_nas_dele",
    padraoExterno: null,
  },
  {
    acao: "delegar",
    nome: "Passar a um especialista",
    mudaDados: true,
    padraoInterno: "executa",
    padraoExterno: null,
  },
  // Pôr outra pessoa ou agente como responsável: pede aprovação.
  {
    acao: "atribuir",
    nome: "Atribuir a outra pessoa",
    mudaDados: true,
    padraoInterno: "pede_aprovacao",
    padraoExterno: null,
  },
  {
    acao: "mudar_prazo",
    nome: "Mudar prazo e prioridade",
    mudaDados: true,
    padraoInterno: "pede_aprovacao",
    padraoExterno: null,
  },
];

/** O padrão de uma ação para um tipo de agente (null: a ação não existe para esse tipo). */
export function padraoDaAcao(acao: string, tipo: "interno" | "externo"): ModoDeAcao | null {
  const a = CATALOGO_DE_ACOES.find((x) => x.acao === acao);
  if (!a) return null;
  return tipo === "interno" ? a.padraoInterno : a.padraoExterno;
}

/**
 * Texto de outros (M4-04, decisão 0026): depois que a execução leu texto escrito por outra pessoa (que não quem pediu)
 * ou por um agente externo, o que muda dados pede aprovação, mesmo que a regra diga executa. Ler e conversar com quem
 * pediu continuam; bloqueado continua bloqueado.
 */
export function modoDepoisDeTextoDeOutros(acao: string, modo: ModoDeAcao): ModoDeAcao {
  const a = CATALOGO_DE_ACOES.find((x) => x.acao === acao);
  if (!a?.mudaDados) return modo;
  return modo === "executa" || modo === "executa_nas_dele" ? "pede_aprovacao" : modo;
}

/**
 * Alto risco (decisão 8 da spec do M4, decisão 0026): na Fase 1, nenhum agente faz, nem com aprovação. Essas ações não
 * existem como ferramenta (o teste barra ferramenta nova com esse jeito); a lista vai no prompt dos agentes internos,
 * que respondem que isso se faz no app, na tela indicada.
 */
export const ACOES_DE_ALTO_RISCO: readonly { assunto: string; ondeNoApp: string }[] = [
  { assunto: "excluir tarefas", ondeNoApp: "na página da tarefa" },
  { assunto: "excluir projetos e espaços", ondeNoApp: "em Projetos" },
  { assunto: "convidar, mudar ou desligar pessoas", ondeNoApp: "em Pessoas" },
  { assunto: "mudar permissões", ondeNoApp: "em Pessoas" },
  { assunto: "segurança e login (2FA, aparelhos, sessões)", ondeNoApp: "em Segurança e em Meu perfil" },
  {
    assunto: "cadastrar, mudar, pausar ou desligar agentes e mexer nas regras deles",
    ondeNoApp: "em Agentes",
  },
  { assunto: "contas de IA e o cofre", ondeNoApp: "em Agentes › Contas de IA" },
  { assunto: "ver a auditoria", ondeNoApp: "em Auditoria" },
  { assunto: "exportar dados", ondeNoApp: "pelo administrador, no app" },
];

/** Começos de nome que denunciam uma ferramenta de alto risco: nenhuma ferramenta de agente pode ter. */
export const PREFIXOS_DE_ALTO_RISCO = [
  "excluir",
  "apagar",
  "remover",
  "desligar",
  "exportar",
  "convidar",
  "permiss",
  "auditoria",
  "seguranca",
  "mudar_regra",
  "mudar_perfil",
  "pausar",
] as const;

/** A regra de uma ação para um agente, como a tela mostra. */
export const RegraDeAgente = Type.Object(
  {
    acao: Texto(60, "O nome da ferramenta."),
    nome: Texto(80, "Como aparece na tela."),
    mudaDados: Type.Boolean(),
    modo: ModoDeAcao,
    /** O modo do catálogo (ou o de agente novo). */
    padrao: ModoDeAcao,
    /** O administrador mudou o padrão. */
    ajustada: Type.Boolean(),
    /** Aprovações seguidas sem edição: aos 20, a tela sugere liberar (a liberação é sempre humana). */
    aprovadasSemEdicao: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type RegraDeAgente = Static<typeof RegraDeAgente>;

export const APROVACOES_PARA_SUGERIR_LIBERAR = 20;

/** Mudar as regras de um agente: modo null volta ao padrão. */
export const PedidoDeMudarRegras = Type.Object(
  {
    regras: Type.Array(
      Type.Object(
        { acao: Texto(60, "O nome da ferramenta."), modo: OuNulo(ModoDeAcao) },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 50 },
    ),
  },
  { additionalProperties: false },
);
export type PedidoDeMudarRegras = Static<typeof PedidoDeMudarRegras>;

export const SITUACOES_DA_APROVACAO = ["pendente", "aprovada", "recusada", "vencida", "falhou"] as const;
export const SituacaoDaAprovacao = Type.Enum(SITUACOES_DA_APROVACAO, {
  description:
    "pendente, aprovada (e executada), recusada, vencida (24 horas sem decisão) ou falhou (aprovada, mas a ação não deu certo).",
});
export type SituacaoDaAprovacao = Static<typeof SituacaoDaAprovacao>;

/** Horas até o pedido vencer. */
export const HORAS_PARA_VENCER = 24;

export const Aprovacao = Type.Object(
  {
    id: Id,
    empresaId: Id,
    agenteId: Id,
    /** A execução do agente interno que pediu (os externos não têm). */
    execucaoId: OuNulo(Id),
    /** Em nome de quem o agente agia (o agente interno, quem pediu; o externo, a pessoa responsável por ele). */
    pedidoPor: Id,
    acao: Texto(60, "O nome da ferramenta."),
    tarefaId: OuNulo(Id),
    /** Os parâmetros exatos que vão ser usados. O texto deles aparece só como texto. */
    parametros: Type.Record(Type.String(), Type.Unknown()),
    /** O que o agente quer fazer, numa frase que o núcleo monta (não é texto do agente). */
    resumo: Texto(300, "O que vai acontecer, numa frase."),
    /** Por que o agente quer fazer, nas palavras dele (texto de agente: mostrado só como texto). */
    motivo: OuNulo(Texto(1000, "Por que, nas palavras do agente.")),
    /** Resumo SHA-256 dos parâmetros: quem aprova manda de volta, e o núcleo confere antes de executar. */
    conferencia: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    situacao: SituacaoDaAprovacao,
    decididaPor: OuNulo(Id),
    decididaEm: OuNulo(DataHora),
    /** Motivo da recusa, ou o erro quando a ação aprovada falhou. */
    observacao: OuNulo(Texto(1000, "Motivo da recusa ou o erro.")),
    /** Quem aprovou mudou os parâmetros antes. */
    editada: Type.Boolean(),
    /** Pedido porque o agente leu texto de outra pessoa antes (a regra dizia executa; M4-04). */
    porTextoDeOutros: Type.Boolean(),
    criadaEm: DataHora,
    venceEm: DataHora,
  },
  { additionalProperties: false, description: "Pedido de aprovação de uma ação de agente." },
);
export type Aprovacao = Static<typeof Aprovacao>;

export const regrasDaAprovacao: Regra<Aprovacao>[] = [
  (a): Problema[] => {
    // Pendente: ninguém decidiu. Vencida: tem a hora, sem pessoa. As outras: quem decidiu e quando.
    const certo =
      a.situacao === "pendente"
        ? a.decididaEm === null && a.decididaPor === null
        : a.situacao === "vencida"
          ? a.decididaEm !== null && a.decididaPor === null
          : a.decididaEm !== null && a.decididaPor !== null;
    return certo
      ? []
      : [{ caminho: "/decididaEm", mensagem: "quem decidiu e quando não batem com a situação" }];
  },
  (a): Problema[] =>
    a.situacao === "recusada" && a.observacao === null
      ? [{ caminho: "/observacao", mensagem: "recusa diz o motivo" }]
      : [],
  (a): Problema[] =>
    Date.parse(a.venceEm) <= Date.parse(a.criadaEm)
      ? [{ caminho: "/venceEm", mensagem: "vence depois de criada" }]
      : [],
];

export function conferirAprovacao(valor: unknown) {
  return conferir(Aprovacao, valor, regrasDaAprovacao);
}

/** Aprovar (podendo editar os parâmetros) ou recusar com motivo. */
export const PedidoDeDecisao = Type.Union([
  Type.Object(
    {
      decisao: Type.Literal("aprovar"),
      /** O resumo dos parâmetros que a pessoa viu (a aprovação recusa se mudou). */
      conferencia: Type.String({ pattern: "^[0-9a-f]{64}$" }),
      /** Parâmetros editados: conferidos pelo formato da ferramenta antes de executar. */
      parametros: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      decisao: Type.Literal("recusar"),
      conferencia: Type.String({ pattern: "^[0-9a-f]{64}$" }),
      motivo: Texto(1000, "Por que recusou (o agente e quem pediu recebem)."),
    },
    { additionalProperties: false },
  ),
]);
export type PedidoDeDecisao = Static<typeof PedidoDeDecisao>;

/** Ações de auditoria das regras e das aprovações. */
export const ACOES_REGRAS_E_APROVACOES = [
  "agente.pediu_aprovacao",
  "agente.mudou_regra",
  "agente.bloqueado",
  "aprovacao.aprovou",
  "aprovacao.recusou",
  "aprovacao.venceu",
  "aprovacao.falhou",
] as const;
