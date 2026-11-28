/**
 * API pública (M7-02, decisão 0047): os endereços em app.osmago.com/api/v1, as chaves de API da empresa (com escopo,
 * validade e IPs) e os limites. Decisões do Sandro na spec do M7 (25/11/2026):
 * 3. Endereço em app.osmago.com/api por enquanto, sem DNS novo (o api.osmago.com pode vir depois, para o mesmo lugar).
 * 4. Documentação pública (não tem dado nenhum).
 * 6. Limite de leitura de 500 registros por hora por agente, que o administrador aumenta quando precisar.
 *
 * Cada endereço é declarado aqui (ROTAS_DA_API_PUBLICA), com o módulo e a ação de permissão, o que recebe e o que
 * devolve. O núcleo monta as rotas e a documentação (OpenAPI) desta lista, e um teste confere que as duas estão em dia.
 * A chave age em nome de uma pessoa da empresa e nunca passa do que essa pessoa pode, nem do escopo da chave.
 */
import { type Static, type TSchema, Type } from "typebox";
import { Agente } from "../agentes/agente.ts";
import { conferir, DataHora, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import {
  Contato,
  ContatoSalvo,
  FiltroDeContatos,
  PedidoDeContato,
  PedidoDeContatosLigados,
  PedidoDeEditarContato,
  ResumoDoContato,
} from "../contatos/contatos.ts";
import {
  ConversaComContato,
  FiltroDeConversas,
  MensagemDaConversa,
  PedidoDePassarConversa,
  PedidoDeTextoNaConversa,
  ResumoDaConversa,
} from "../conversas/conversas.ts";
import { Projeto } from "../projetos/projeto.ts";
import {
  ComentarioDeTarefa,
  FiltroDeTarefas,
  PedidoDeComentario,
  PedidoDeMudarStatus,
  PedidoDeTarefa,
  Tarefa,
} from "../tarefas/tarefa.ts";

/** A chave inteira: "mago_api_" + 10 caracteres de identificação + "_" + 43 do segredo (32 bytes em base64url). */
export const FORMATO_DA_CHAVE_DE_API = /^mago_api_([0-9a-z]{10})_([A-Za-z0-9_-]{43})$/;

export const PrefixoDaChaveDeApi = Type.String({
  pattern: "^mago_api_[0-9a-z]{10}$",
  description: "Começo da chave, para reconhecê-la na lista. Não dá acesso a nada sozinho.",
});

/** Os módulos que a API pública abre no começo. Cada chave diz, por módulo, se só lê ou também escreve. */
export const MODULOS_DA_API = ["tarefas", "projetos", "contatos", "agentes", "conversas"] as const;
export const ModuloDaApi = Type.Enum(MODULOS_DA_API);
export type ModuloDaApi = Static<typeof ModuloDaApi>;

export const ACESSOS_DA_API = ["ler", "escrever"] as const;
export const AcessoDaApi = Type.Enum(ACESSOS_DA_API, {
  description: "ler (só consultas) ou escrever (consultas e mudanças).",
});
export type AcessoDaApi = Static<typeof AcessoDaApi>;

/** Os módulos da chave e o acesso em cada um; módulo ausente: a chave não alcança. */
export const EscopoDaChave = Type.Object(
  {
    tarefas: Type.Optional(AcessoDaApi),
    projetos: Type.Optional(AcessoDaApi),
    contatos: Type.Optional(AcessoDaApi),
    agentes: Type.Optional(AcessoDaApi),
    /** As conversas com contatos (M8-11, decisão 0060). */
    conversas: Type.Optional(AcessoDaApi),
  },
  { additionalProperties: false, minProperties: 1, description: "Módulos que a chave alcança." },
);
export type EscopoDaChave = Static<typeof EscopoDaChave>;

/** Um IP (v4 ou v6) ou uma faixa em CIDR (ex.: 203.0.113.0/24). */
export const IpOuFaixa = Type.String({
  pattern:
    "^(([0-9]{1,3}\\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?|[0-9a-fA-F:]{2,39}(/([0-9]{1,2}|1[01][0-9]|12[0-8]))?)$",
  description: "IP ou faixa em CIDR de onde a chave pode ser usada.",
});

/** No máximo 20 IPs ou faixas por chave. */
export const MAXIMO_DE_IPS = 20;
/** Validade padrão de uma chave nova: 1 ano. A máxima também é 1 ano (troca anual). */
export const DIAS_DE_VALIDADE_PADRAO = 365;
/** Na troca, a chave antiga continua valendo por 24 horas, para dar tempo de atualizar o sistema de fora. */
export const HORAS_DA_CHAVE_ANTIGA_NA_TROCA = 24;

export const ChaveDeApi = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: Texto(80, "Para que serve a chave (ex.: n8n da 4xpert)."),
    prefixo: PrefixoDaChaveDeApi,
    /** A pessoa em nome de quem a chave age (padrão: quem criou). A chave nunca passa do que ela pode. */
    pessoaId: Id,
    escopo: EscopoDaChave,
    /** Vazio: de qualquer lugar. */
    ips: Type.Array(IpOuFaixa, { maxItems: MAXIMO_DE_IPS }),
    validaAte: DataHora,
    criadaPor: Id,
    criadaEm: DataHora,
    ultimoUsoEm: OuNulo(DataHora),
    revogadaEm: OuNulo(DataHora),
    revogadaPor: OuNulo(Id),
    /** A chave nova que a substituiu numa troca (esta vale até validaAte, 24 horas depois). */
    trocadaPorId: OuNulo(Id),
  },
  { additionalProperties: false, description: "Chave de API da empresa (sem o segredo)." },
);
export type ChaveDeApi = Static<typeof ChaveDeApi>;

/** Criar uma chave (só o administrador). Sem validade: 1 ano. Sem pessoa: quem cria. */
export const PedidoDeChaveDeApi = Type.Object(
  {
    nome: Texto(80, "Para que serve a chave."),
    escopo: EscopoDaChave,
    pessoaId: Type.Optional(Id),
    ips: Type.Optional(Type.Array(IpOuFaixa, { maxItems: MAXIMO_DE_IPS, uniqueItems: true })),
    validaAte: Type.Optional(DataHora),
  },
  { additionalProperties: false },
);
export type PedidoDeChaveDeApi = Static<typeof PedidoDeChaveDeApi>;

export function conferirPedidoDeChaveDeApi(valor: unknown, agora = new Date()) {
  return conferir(PedidoDeChaveDeApi, valor, [
    (p): Problema[] => {
      if (!p.validaAte) return [];
      const t = Date.parse(p.validaAte);
      if (t <= agora.getTime())
        return [{ caminho: "/validaAte", mensagem: "a validade precisa ser no futuro" }];
      if (t > agora.getTime() + DIAS_DE_VALIDADE_PADRAO * 86_400_000 + 86_400_000)
        return [{ caminho: "/validaAte", mensagem: "a chave vale no máximo 1 ano" }];
      return [];
    },
  ]);
}

/** A resposta de criar e de trocar: a chave inteira vem só aqui, uma vez. */
export const ChaveDeApiCriada = Type.Object(
  {
    chave: ChaveDeApi,
    segredo: Type.String({
      pattern: FORMATO_DA_CHAVE_DE_API.source,
      description: "A chave inteira. Mostrada uma vez só.",
    }),
  },
  { additionalProperties: false },
);
export type ChaveDeApiCriada = Static<typeof ChaveDeApiCriada>;

/** Limites (decisão 0047): por chave e por empresa, para uma empresa não derrubar as outras. */
export const LIMITES_DA_API = {
  pedidosPorMinutoPorChave: 120,
  pedidosPorMinutoPorEmpresa: 600,
  /** Mensagens a contatos pela API (M8-11, decisão 0060), por chave, por hora. */
  mensagensPorHoraPorChave: 60,
} as const;

/** Por que a API recusou a chave (vai para a auditoria, nunca a chave em si). */
export const MOTIVOS_DE_RECUSA_DA_API = [
  "formato",
  "desconhecida",
  "revogada",
  "vencida",
  "ip",
  "fora_do_escopo",
  "sem_permissao",
  "canal",
  "passou_do_limite",
] as const;
export type MotivoDeRecusaDaApi = (typeof MOTIVOS_DE_RECUSA_DA_API)[number];

/** O erro que a API pública devolve: um código fixo e a explicação em português. */
export const ErroDaApi = Type.Object(
  {
    code: Type.String({ description: "Código fixo do erro (ex.: FORA_DO_ESCOPO)." }),
    message: Type.String({ description: "O que aconteceu, em português." }),
  },
  { additionalProperties: false },
);

// Os endereços --------------------------------------------------------------------------------------------------

export interface RotaDaApiPublica {
  /** Nome curto e único (vira o operationId da documentação). */
  id: string;
  metodo: "GET" | "POST" | "DELETE";
  /** Caminho depois de /api, com {id} para os parâmetros (ex.: /v1/tarefas/{id}). */
  caminho: string;
  modulo: ModuloDaApi;
  /** "ler" passa com qualquer acesso ao módulo; "escrever" pede o acesso escrever. */
  precisa: AcessoDaApi;
  /** A ação de permissão da pessoa em nome de quem a chave age (a mesma da tela). */
  acao: "ver" | "criar" | "editar";
  resumo: string;
  descricao: string;
  /** A query (GET) ou o corpo (POST). */
  entrada: TSchema | null;
  saida: TSchema;
  /** Um exemplo de corpo ou de query, para a documentação. */
  exemplo?: Record<string, unknown>;
}

const Lista = <T extends TSchema>(nome: string, item: T) =>
  Type.Object({ [nome]: Type.Array(item) }, { additionalProperties: false });

export const ROTAS_DA_API_PUBLICA: readonly RotaDaApiPublica[] = [
  {
    id: "listarTarefas",
    metodo: "GET",
    caminho: "/v1/tarefas",
    modulo: "tarefas",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar tarefas",
    descricao:
      "As tarefas que a pessoa da chave vê, das mais recentes para as mais antigas (até 200). Filtre por status, projeto, responsável, prazo, contato ou texto.",
    entrada: FiltroDeTarefas,
    saida: Lista("tarefas", Tarefa),
    exemplo: { status: "a_fazer,em_andamento", texto: "proposta" },
  },
  {
    id: "verTarefa",
    metodo: "GET",
    caminho: "/v1/tarefas/{id}",
    modulo: "tarefas",
    precisa: "ler",
    acao: "ver",
    resumo: "Ver uma tarefa",
    descricao: "Uma tarefa que a pessoa da chave vê.",
    entrada: null,
    saida: Tarefa,
  },
  {
    id: "criarTarefa",
    metodo: "POST",
    caminho: "/v1/tarefas",
    modulo: "tarefas",
    precisa: "escrever",
    acao: "criar",
    resumo: "Criar uma tarefa",
    descricao: "Cria a tarefa em nome da pessoa da chave. Sem responsável, fica com ela.",
    entrada: PedidoDeTarefa,
    saida: Tarefa,
    exemplo: { titulo: "Ligar para a Beatriz da Acme", prioridade: "alta", prazo: { dia: "2026-12-01" } },
  },
  {
    id: "mudarStatusDaTarefa",
    metodo: "POST",
    caminho: "/v1/tarefas/{id}/status",
    modulo: "tarefas",
    precisa: "escrever",
    acao: "editar",
    resumo: "Mudar o status de uma tarefa",
    descricao:
      "Muda o status (a fazer, em andamento, precisa de ajuda, concluída ou cancelada). Ao concluir, pode levar o resultado.",
    entrada: PedidoDeMudarStatus,
    saida: Tarefa,
    exemplo: { status: "concluida", resultado: "Proposta enviada por e-mail." },
  },
  {
    id: "listarComentarios",
    metodo: "GET",
    caminho: "/v1/tarefas/{id}/comentarios",
    modulo: "tarefas",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar os comentários de uma tarefa",
    descricao:
      "Os comentários de uma tarefa que a pessoa da chave vê, do mais antigo para o mais novo. As notas internas não vêm.",
    entrada: null,
    saida: Lista("comentarios", ComentarioDeTarefa),
  },
  {
    id: "comentar",
    metodo: "POST",
    caminho: "/v1/tarefas/{id}/comentarios",
    modulo: "tarefas",
    precisa: "escrever",
    acao: "editar",
    resumo: "Comentar numa tarefa",
    descricao: "Escreve um comentário em nome da pessoa da chave, marcado como vindo da API.",
    entrada: PedidoDeComentario,
    saida: ComentarioDeTarefa,
    exemplo: { texto: "Cliente confirmou a reunião pelo formulário do site." },
  },
  {
    id: "ligarContatosATarefa",
    metodo: "POST",
    caminho: "/v1/tarefas/{id}/contatos",
    modulo: "contatos",
    precisa: "escrever",
    acao: "editar",
    resumo: "Ligar contatos a uma tarefa",
    descricao: "Troca os contatos citados na tarefa (lista completa, até 20). Precisa poder editar a tarefa.",
    entrada: PedidoDeContatosLigados,
    saida: Lista("contatos", ResumoDoContato),
  },
  {
    id: "listarProjetos",
    metodo: "GET",
    caminho: "/v1/projetos",
    modulo: "projetos",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar projetos",
    descricao: "Os projetos ativos que a pessoa da chave vê.",
    entrada: null,
    saida: Lista("projetos", Projeto),
  },
  {
    id: "verProjeto",
    metodo: "GET",
    caminho: "/v1/projetos/{id}",
    modulo: "projetos",
    precisa: "ler",
    acao: "ver",
    resumo: "Ver um projeto",
    descricao: "Um projeto que a pessoa da chave vê.",
    entrada: null,
    saida: Projeto,
  },
  {
    id: "listarContatos",
    metodo: "GET",
    caminho: "/v1/contatos",
    modulo: "contatos",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar contatos",
    descricao:
      "Os contatos que a pessoa da chave vê, em ordem de nome (até 200). Filtre por texto (nome, e-mail, telefone ou rede), tipo, papel, etiqueta, responsável ou organização.",
    entrada: FiltroDeContatos,
    saida: Lista("contatos", ResumoDoContato),
    exemplo: { texto: "acme", papeis: "cliente" },
  },
  {
    id: "verContato",
    metodo: "GET",
    caminho: "/v1/contatos/{id}",
    modulo: "contatos",
    precisa: "ler",
    acao: "ver",
    resumo: "Ver um contato",
    descricao: "Um contato que a pessoa da chave vê, com todos os e-mails, telefones e redes.",
    entrada: null,
    saida: Contato,
  },
  {
    id: "criarContato",
    metodo: "POST",
    caminho: "/v1/contatos",
    modulo: "contatos",
    precisa: "escrever",
    acao: "criar",
    resumo: "Cadastrar um contato",
    descricao:
      "Cadastra uma pessoa ou organização. Telefones no formato internacional (+5511987654321). Se o e-mail ou o telefone já existe em outro contato, a resposta avisa em repetidos (não bloqueia).",
    entrada: PedidoDeContato,
    saida: ContatoSalvo,
    exemplo: {
      tipo: "pessoa",
      nome: "Beatriz Lima",
      papeis: ["lead"],
      identificadores: [{ tipo: "email", valor: "beatriz@acme.com.br", principal: true }],
    },
  },
  {
    id: "editarContato",
    metodo: "POST",
    caminho: "/v1/contatos/{id}",
    modulo: "contatos",
    precisa: "escrever",
    acao: "editar",
    resumo: "Mudar um contato",
    descricao:
      "Só o que vier muda. E-mails, telefones, redes, organizações, papéis e etiquetas vêm com a lista completa (a nova substitui a antiga).",
    entrada: PedidoDeEditarContato,
    saida: ContatoSalvo,
    exemplo: { papeis: ["cliente"] },
  },
  {
    id: "listarAgentes",
    metodo: "GET",
    caminho: "/v1/agentes",
    modulo: "agentes",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar agentes",
    descricao: "Os agentes da empresa (para escolher um como responsável de uma tarefa).",
    entrada: null,
    saida: Lista("agentes", Agente),
  },
  // Conversas com contatos (M8-11, decisão 0060): o que a pessoa da chave vê pela caixa (a equipe do canal).
  {
    id: "listarConversas",
    metodo: "GET",
    caminho: "/v1/conversas",
    modulo: "conversas",
    precisa: "ler",
    acao: "ver",
    resumo: "Listar conversas",
    descricao:
      "As conversas com contatos (WhatsApp e chat do site) que a pessoa da chave vê, das mais recentes para as mais antigas (até 100). Filtre por situação, canal, contato, dono, se está com o agente ou texto.",
    entrada: FiltroDeConversas,
    saida: Lista("conversas", ResumoDaConversa),
    exemplo: { situacoes: "esperando_equipe" },
  },
  {
    id: "verConversa",
    metodo: "GET",
    caminho: "/v1/conversas/{id}",
    modulo: "conversas",
    precisa: "ler",
    acao: "ver",
    resumo: "Ver uma conversa",
    descricao:
      "Uma conversa com as últimas 50 mensagens (as que chegaram, as que saíram e as notas internas). Arquivos vêm com o tipo e o nome, sem o arquivo.",
    entrada: null,
    saida: Type.Object(
      { conversa: ConversaComContato, mensagens: Type.Array(MensagemDaConversa) },
      { additionalProperties: false },
    ),
  },
  {
    id: "mandarMensagem",
    metodo: "POST",
    caminho: "/v1/conversas/{id}/mensagens",
    modulo: "conversas",
    precisa: "escrever",
    acao: "criar",
    resumo: "Mandar mensagem ao contato",
    descricao:
      "Manda uma mensagem de texto ao contato, numa conversa que já existe e não está resolvida (pela API não dá para abrir conversa nova). No máximo 60 mensagens por hora por chave. A mensagem aparece na caixa como enviada pela API.",
    entrada: PedidoDeTextoNaConversa,
    saida: Type.Object({ mensagemId: Id }, { additionalProperties: false }),
    exemplo: { texto: "Olá! Seu pedido saiu para entrega." },
  },
  {
    id: "escreverNota",
    metodo: "POST",
    caminho: "/v1/conversas/{id}/notas",
    modulo: "conversas",
    precisa: "escrever",
    acao: "criar",
    resumo: "Escrever nota interna",
    descricao: "Escreve uma nota interna na conversa. Só a equipe vê; o contato nunca vê.",
    entrada: PedidoDeTextoNaConversa,
    saida: Type.Object({ mensagemId: Id }, { additionalProperties: false }),
    exemplo: { texto: "Cliente pediu a segunda via do boleto." },
  },
  {
    id: "atribuirConversa",
    metodo: "POST",
    caminho: "/v1/conversas/{id}/atribuir",
    modulo: "conversas",
    precisa: "escrever",
    acao: "editar",
    resumo: "Passar a conversa para uma pessoa",
    descricao:
      "Passa a conversa para uma pessoa da empresa que vê as conversas do canal. Ela recebe um aviso.",
    entrada: PedidoDePassarConversa,
    saida: Type.Object({ conversa: ConversaComContato }, { additionalProperties: false }),
  },
  {
    id: "resolverConversa",
    metodo: "POST",
    caminho: "/v1/conversas/{id}/resolver",
    modulo: "conversas",
    precisa: "escrever",
    acao: "editar",
    resumo: "Resolver a conversa",
    descricao:
      "Resolve a conversa. Ela não reabre sozinha: a próxima mensagem do contato abre uma conversa nova.",
    entrada: null,
    saida: Type.Object({ conversa: ConversaComContato }, { additionalProperties: false }),
  },
];

/** Ações de auditoria da API pública. Nos detalhes vão ids, o escopo e o motivo da recusa, nunca a chave. */
export const ACOES_DA_API = [
  "chave_api.criou",
  "chave_api.trocou",
  "chave_api.revogou",
  "chave_api.recusou",
  // A chave revogada ou vencida saiu da lista da tela (pedido do Sandro em 26/11/2026); a linha fica guardada.
  "chave_api.removeu",
] as const;
export type AcaoDaApi = (typeof ACOES_DA_API)[number];
