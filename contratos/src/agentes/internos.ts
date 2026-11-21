/**
 * Agentes internos (M4-02): o coordenador e o especialista que rodam dentro do Mago OS, a conversa com o coordenador
 * no app, o registro de cada execução e as ferramentas que eles usam. Ver docs/decisoes/0023.
 *
 * O agente interno não tem acesso direto ao banco nem à internet: cada coisa que ele faz é uma ferramenta daqui,
 * que o núcleo executa com as mesmas regras de permissão e auditoria das telas e do MCP. As descrições são
 * congeladas por teste, como as do MCP (o texto muda o que o agente faz).
 */
import { type Static, type TSchema, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";
import { PedidoDePrazo, Prioridade } from "../tarefas/prazos.ts";
import { Responsavel, StatusTarefa } from "../tarefas/tarefa.ts";
import { ModeloEscolhido } from "./contas-de-ia.ts";

/** Papel do agente interno na hierarquia: o coordenador recebe os pedidos e passa ao especialista. */
export const PAPEIS_DE_AGENTE = ["coordenador", "especialista"] as const;
export const PapelDeAgente = Type.Enum(PAPEIS_DE_AGENTE, {
  description: "coordenador (porta de entrada) ou especialista (faz o trabalho de uma área).",
});
export type PapelDeAgente = Static<typeof PapelDeAgente>;

/** Especialidades que existem. No M4, só o Gerente de projetos (decisão 3 da spec). */
export const ESPECIALIDADES = ["gerente_de_projetos"] as const;
export const Especialidade = Type.Enum(ESPECIALIDADES, {
  description:
    "gerente_de_projetos: planeja tarefas em subtarefas e checklist, distribui e acompanha prazos.",
});
export type Especialidade = Static<typeof Especialidade>;

/** Os dois agentes com que toda empresa nasce (pausados até haver uma conta de IA e o modelo escolhido). */
export const AGENTES_DE_NASCENCA = [
  { nome: "Coordenador", papel: "coordenador", especialidade: null },
  { nome: "Gerente de projetos", papel: "especialista", especialidade: "gerente_de_projetos" },
] as const;

// Conversa no app (decisão 5 da spec): cada pessoa tem as próprias conversas com o coordenador.

export const Conversa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    /** Dona da conversa: só ela vê. */
    pessoaId: Id,
    agenteId: Id,
    titulo: Texto(120, "Título da conversa (a primeira frase do pedido, ou o que a pessoa escolher)."),
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Conversa de uma pessoa com um agente interno." },
);
export type Conversa = Static<typeof Conversa>;

export const AutorDaMensagem = Type.Union([
  Type.Object({ tipo: Type.Literal("pessoa"), pessoaId: Id }, { additionalProperties: false }),
  Type.Object({ tipo: Type.Literal("agente"), agenteId: Id }, { additionalProperties: false }),
  Type.Object({ tipo: Type.Literal("sistema") }, { additionalProperties: false }),
]);
export type AutorDaMensagem = Static<typeof AutorDaMensagem>;

/** O texto que o agente escreve aparece sempre como texto, nunca como HTML (como já é no M2). */
const TextoDaMensagem = Texto(8000, "O texto da mensagem.");

export const MensagemDeConversa = Type.Object(
  {
    id: Id,
    conversaId: Id,
    autor: AutorDaMensagem,
    texto: TextoDaMensagem,
    /** A execução que produziu a mensagem do agente (para abrir o passo a passo, M4-07). */
    execucaoId: OuNulo(Id),
    /** Tarefas criadas ou citadas na mensagem, para a tela mostrar o link. */
    tarefas: Type.Array(Id, { maxItems: 20 }),
    criadaEm: DataHora,
  },
  { additionalProperties: false },
);
export type MensagemDeConversa = Static<typeof MensagemDeConversa>;

/**
 * O que a pessoa manda. Sem conversaId, começa uma conversa nova: com o coordenador ou, se ela puder (padrão:
 * administrador e gestor), direto com um especialista (agenteId).
 */
export const PedidoDeMensagem = Type.Object(
  {
    conversaId: Type.Optional(Id),
    agenteId: Type.Optional(Id),
    texto: Texto(4000, "O pedido ou a resposta da pessoa."),
  },
  { additionalProperties: false },
);
export type PedidoDeMensagem = Static<typeof PedidoDeMensagem>;

// Execução: cada vez que um agente interno trabalha (responder uma mensagem, cuidar de uma tarefa, receber uma
// delegação). O custo e os tokens entram na M4-06; o passo a passo, na M4-07.

/** De onde veio o trabalho. */
export const ORIGENS_DA_EXECUCAO = ["conversa", "tarefa", "delegacao"] as const;
export const OrigemDaExecucao = Type.Enum(ORIGENS_DA_EXECUCAO);
export type OrigemDaExecucao = Static<typeof OrigemDaExecucao>;

/** na_fila → rodando → concluida, falhou ou parada (pelo botão de parar ou pelos limites da M4-08). */
export const SITUACOES_DA_EXECUCAO = ["na_fila", "rodando", "concluida", "falhou", "parada"] as const;
export const SituacaoDaExecucao = Type.Enum(SITUACOES_DA_EXECUCAO);
export type SituacaoDaExecucao = Static<typeof SituacaoDaExecucao>;

export const ExecucaoDeAgente = Type.Object(
  {
    id: Id,
    empresaId: Id,
    agenteId: Id,
    /** Quem pediu: o agente age com a permissão dessa pessoa (a menor das duas, M4-04). */
    pedidoPor: Id,
    origem: OrigemDaExecucao,
    conversaId: OuNulo(Id),
    tarefaId: OuNulo(Id),
    /** A execução que delegou esta (o coordenador que passou ao especialista). */
    execucaoMaeId: OuNulo(Id),
    situacao: SituacaoDaExecucao,
    /** O modelo que rodou de verdade, e por que passou ao reserva (se passou). */
    modeloUsado: OuNulo(ModeloEscolhido),
    passouAoReservaPorque: OuNulo(Texto(300, "Por que o modelo reserva entrou.")),
    /** Resumo do resultado, ou o erro em texto curto. */
    resumo: OuNulo(Texto(2000, "O que a execução fez, em poucas linhas.")),
    criadaEm: DataHora,
    iniciadaEm: OuNulo(DataHora),
    terminadaEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Uma execução de um agente interno." },
);
export type ExecucaoDeAgente = Static<typeof ExecucaoDeAgente>;

export const regrasDaExecucao: Regra<ExecucaoDeAgente>[] = [
  (e): Problema[] => {
    if (e.origem === "conversa" && e.conversaId === null)
      return [{ caminho: "/conversaId", mensagem: "execução de conversa diz qual conversa" }];
    if (e.origem === "tarefa" && e.tarefaId === null)
      return [{ caminho: "/tarefaId", mensagem: "execução de tarefa diz qual tarefa" }];
    if (e.origem === "delegacao" && (e.execucaoMaeId === null || e.tarefaId === null))
      return [{ caminho: "/execucaoMaeId", mensagem: "delegação diz quem delegou e qual tarefa" }];
    return [];
  },
  (e): Problema[] => {
    const terminou = e.situacao === "concluida" || e.situacao === "falhou" || e.situacao === "parada";
    if (terminou !== (e.terminadaEm !== null))
      return [{ caminho: "/terminadaEm", mensagem: "só a execução terminada tem a hora do fim" }];
    if (e.situacao !== "na_fila" && e.iniciadaEm === null)
      return [{ caminho: "/iniciadaEm", mensagem: "execução que começou tem a hora do início" }];
    return [];
  },
];

export function conferirExecucao(valor: unknown) {
  return conferir(ExecucaoDeAgente, valor, regrasDaExecucao);
}

// Ferramentas dos agentes internos. O especialista usa também as do MCP (FERRAMENTAS_DO_MCP_NO_ESPECIALISTA).

export interface FerramentaInterna<E extends TSchema = TSchema> {
  nome: string;
  /** Texto que o modelo lê para decidir. Congelado pelo teste de assinatura. */
  descricao: string;
  entrada: E;
  /** Quem pode usar. */
  papeis: readonly PapelDeAgente[];
}

const SubtarefaPlanejada = Type.Object(
  {
    titulo: Texto(200, "O que precisa ser feito, numa linha."),
    descricao: Type.Optional(Texto(4000, "Detalhes.")),
    prazo: Type.Optional(PedidoDePrazo),
    prioridade: Type.Optional(Prioridade),
  },
  { additionalProperties: false },
);

export const FERRAMENTAS_INTERNAS = [
  {
    nome: "ver_tarefa",
    descricao:
      "Abre uma tarefa que quem pediu enxerga, com a descrição, os comentários (sem as notas internas), as subtarefas, o checklist e os nomes dos anexos. Use antes de responder sobre uma tarefa ou mexer nela.",
    entrada: Type.Object({ tarefaId: Id }, { additionalProperties: false }),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "comentar",
    descricao:
      "Comenta numa tarefa que quem pediu enxerga. O comentário fica marcado como seu (do agente) e quem segue a tarefa é avisado. Para mencionar alguém, use @ e o nome.",
    entrada: Type.Object(
      { tarefaId: Id, texto: Texto(4000, "O comentário.") },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "procurar_pessoa",
    descricao:
      "Procura pessoas e agentes da empresa pelo nome (sem diferença de acento ou maiúscula), entre os que quem pediu enxerga. Devolve o tipo, o id, o nome e a área. Use para achar o id antes de atribuir uma tarefa a alguém. Se vier mais de um ou nenhum, pergunte.",
    entrada: Type.Object(
      { nome: Texto(120, "O nome, ou parte dele, como a pessoa disse.") },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "mudar_prazo",
    descricao:
      "Muda o prazo e/ou a prioridade de uma tarefa existente. Mande só o que muda; null tira o prazo ou a prioridade. Pela regra da empresa, isso costuma pedir aprovação: avise a pessoa que o pedido foi enviado.",
    entrada: Type.Object(
      {
        tarefaId: Id,
        prazo: Type.Optional(OuNulo(PedidoDePrazo)),
        prioridade: Type.Optional(OuNulo(Prioridade)),
      },
      { additionalProperties: false, minProperties: 2 },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "mudar_projeto",
    descricao:
      "Põe uma tarefa num projeto (use procurar_projeto para achar o id), ou tira do projeto com null. Subtarefa segue sempre a tarefa-mãe.",
    entrada: Type.Object({ tarefaId: Id, projetoId: OuNulo(Id) }, { additionalProperties: false }),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "acrescentar_checklist",
    descricao: "Acrescenta itens ao checklist de uma tarefa que já existe, um passo curto por item.",
    entrada: Type.Object(
      { tarefaId: Id, itens: Type.Array(Texto(500, "Um passo curto."), { minItems: 1, maxItems: 30 }) },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "minhas_prioridades",
    descricao:
      'A central de prioridades de quem pediu, na ordem do Mago OS: atrasadas, vencendo hoje, precisando de ajuda, menções e avisos. Use para responder "o que eu tenho para hoje?".',
    entrada: Type.Object({}, { additionalProperties: false }),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "buscar",
    descricao:
      'A mesma busca do Ctrl+K: procura o texto em tarefas, comentários, projetos, espaços, pessoas e agentes que quem pediu enxerga (sem diferença de acento e com tolerância a erro de digitação). Use para perguntas como "onde falamos do contrato?".',
    entrada: Type.Object({ texto: Texto(120, "O que procurar.") }, { additionalProperties: false }),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "listar_tarefas",
    descricao:
      'Lista as tarefas que quem pediu enxerga, das mais recentes para as mais antigas, com título, status, prioridade, prazo, projeto e responsável. Filtros: minhas (as de quem pediu), status, projeto (id, ou "sem" para as sem projeto), prazo (atrasadas, hoje, semana, sem_prazo) e texto no título. Use para responder perguntas sobre as tarefas e para achar o id de uma tarefa citada.',
    entrada: Type.Object(
      {
        minhas: Type.Optional(Type.Boolean()),
        status: Type.Optional(Type.Array(StatusTarefa, { minItems: 1, uniqueItems: true })),
        projetoId: Type.Optional(Type.Union([Id, Type.Literal("sem")])),
        prazo: Type.Optional(Type.Enum(["atrasadas", "hoje", "semana", "sem_prazo"] as const)),
        texto: Type.Optional(Texto(120, "Parte do título.")),
        limite: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 50, description: "Quantas no máximo (padrão 30)." }),
        ),
      },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "procurar_projeto",
    descricao:
      "Procura os projetos da empresa pelo nome (sem diferença de acento ou maiúscula), entre os que quem pediu alcança. Use quando a pessoa citar um projeto, para pegar o id antes de criar a tarefa. Se vier mais de um ou nenhum, pergunte à pessoa.",
    entrada: Type.Object(
      { nome: Texto(120, "O nome do projeto, ou parte dele, como a pessoa disse.") },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "criar_tarefa",
    descricao:
      "Cria uma tarefa a partir do pedido da pessoa, com título curto e claro, a descrição do que se espera e o prazo, se a pessoa disse. A tarefa fica com a permissão de quem pediu: se a pessoa não poderia criar, a ferramenta recusa. Criada pelo coordenador, fica com quem pediu; criada por um especialista, fica com ele, para planejar em seguida.",
    entrada: Type.Object(
      {
        titulo: Texto(200, "O que precisa ser feito, numa linha."),
        descricao: Type.Optional(Texto(20000, "Detalhes e o que se espera.")),
        projetoId: Type.Optional(Id),
        prazo: Type.Optional(PedidoDePrazo),
        prioridade: Type.Optional(Prioridade),
      },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "delegar",
    descricao:
      "Passa uma tarefa ao especialista certo, com instruções do que fazer. Use quando o pedido é de uma área que um especialista cuida (por exemplo, planejar um projeto vai para o Gerente de projetos). O especialista recebe só o que você poderia fazer.",
    entrada: Type.Object(
      {
        tarefaId: Id,
        agenteId: Id,
        instrucoes: Texto(4000, "O que o especialista deve fazer e o que entregar."),
      },
      { additionalProperties: false },
    ),
    papeis: ["coordenador"],
  },
  {
    nome: "perguntar",
    descricao:
      "Faz uma pergunta à pessoa quando falta algo para seguir (prazo, projeto, quem cuida). A execução para aqui e continua quando a pessoa responder.",
    entrada: Type.Object(
      { pergunta: Texto(2000, "A pergunta, curta e direta.") },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "responder",
    descricao:
      "Responde à pessoa na conversa e encerra a execução. Diga o que foi feito e o link das tarefas criadas, em poucas frases.",
    entrada: Type.Object(
      {
        texto: Texto(8000, "A resposta."),
        tarefas: Type.Optional(Type.Array(Id, { maxItems: 20, uniqueItems: true })),
      },
      { additionalProperties: false },
    ),
    papeis: ["coordenador", "especialista"],
  },
  {
    nome: "planejar",
    descricao:
      "Quebra uma tarefa em subtarefas e checklist de uma vez. Use subtarefas para partes que alguém faz e o checklist para passos curtos. Não atribui ninguém: para isso, use atribuir.",
    entrada: Type.Object(
      {
        tarefaId: Id,
        subtarefas: Type.Array(SubtarefaPlanejada, { maxItems: 30 }),
        checklist: Type.Array(Texto(500, "Um passo curto."), { maxItems: 50 }),
      },
      { additionalProperties: false, minProperties: 2 },
    ),
    papeis: ["especialista"],
  },
  {
    nome: "atribuir",
    descricao:
      "Põe uma pessoa ou um agente da empresa como responsável por uma tarefa ou subtarefa. Escolha quem tem a ver com o assunto e não está sobrecarregado.",
    entrada: Type.Object({ tarefaId: Id, responsavel: Responsavel }, { additionalProperties: false }),
    papeis: ["especialista"],
  },
] as const satisfies readonly FerramentaInterna[];

export type NomeDeFerramentaInterna = (typeof FERRAMENTAS_INTERNAS)[number]["nome"];

/**
 * Ferramentas do MCP de hoje que o especialista também usa (as mesmas regras e a mesma auditoria). Ver tarefa e
 * comentar têm versão própria dos agentes internos (com o alcance de quem pediu), em FERRAMENTAS_INTERNAS.
 */
export const FERRAMENTAS_DO_MCP_NO_ESPECIALISTA = [
  "mudar_status",
  "criar_subtarefa",
  "marcar_checklist",
  "entregar_resultado",
] as const;

/** Ações de auditoria dos agentes internos (as ações nas tarefas usam os eventos que já existem). */
export const ACOES_AGENTES_INTERNOS = [
  "agente.delegou",
  "agente.executou",
  "agente.falhou",
  "conversa.apagou",
] as const;
