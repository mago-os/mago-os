/**
 * Contatos (M7-01, decisão 0045): o cadastro único de pessoas e organizações de fora da empresa (clientes, leads,
 * fornecedores, parceiros). WhatsApp, CRM, atendimento e portal (M8 em diante) ligam tudo a um contato.
 *
 * Decisões do Sandro na spec do M7 (25/11/2026):
 * 1. Dois tipos, pessoa e organização; a pessoa pode estar ligada a uma ou mais organizações, com o cargo.
 * 2. Duplicados: o sistema só avisa e sugere juntar; quem decide e junta é uma pessoa, na tela.
 *
 * Um e-mail ou telefone repetido na mesma empresa não bloqueia o cadastro (recepção, família, contato@): a resposta
 * traz o aviso "já existe em outro contato". Juntar e apagar são de alto risco e não viram ferramenta de agente.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Email, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { FusoHorario } from "../identidade/pessoa.ts";

export const TIPOS_DE_CONTATO = ["pessoa", "organizacao"] as const;
export const TipoDeContato = Type.Enum(TIPOS_DE_CONTATO, { description: "pessoa ou organizacao." });
export type TipoDeContato = Static<typeof TipoDeContato>;

/** O papel do contato para a empresa; pode ter mais de um ao mesmo tempo (um cliente que também é parceiro). */
export const PAPEIS_DE_CONTATO = ["lead", "cliente", "fornecedor", "parceiro", "outro"] as const;
export const PapelDeContato = Type.Enum(PAPEIS_DE_CONTATO, {
  description: "lead, cliente, fornecedor, parceiro ou outro.",
});
export type PapelDeContato = Static<typeof PapelDeContato>;

export const NOMES_DOS_PAPEIS: Record<PapelDeContato, string> = {
  lead: "Lead",
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  parceiro: "Parceiro",
  outro: "Outro",
};

/**
 * ativo; arquivado (escondido das listas, sem apagar nada, dá para desarquivar); juntado (foi juntado em outro
 * contato: fica guardado só para levar quem abrir o endereço antigo ao contato que ficou).
 */
export const SITUACOES_DE_CONTATO = ["ativo", "arquivado", "juntado"] as const;
export const SituacaoDeContato = Type.Enum(SITUACOES_DE_CONTATO);
export type SituacaoDeContato = Static<typeof SituacaoDeContato>;

/** As redes que aparecem com nome e ícone; o resto vai como "outra". */
export const REDES = [
  "instagram",
  "linkedin",
  "facebook",
  "tiktok",
  "x",
  "youtube",
  "site",
  "outra",
] as const;
export const Rede = Type.Enum(REDES);
export type Rede = Static<typeof Rede>;

/** Telefone no formato internacional (E.164): + e de 8 a 15 dígitos (ex.: +5511987654321). */
export const Telefone = Type.String({
  pattern: "^\\+[1-9][0-9]{7,14}$",
  description: "Telefone no formato internacional, com + e o código do país (ex.: +5511987654321).",
});

export const MAXIMO_DE_IDENTIFICADORES = 20;
export const MAXIMO_DE_ORGANIZACOES = 10;
export const MAXIMO_DE_ETIQUETAS_NO_CONTATO = 20;
/** Uma tarefa ou um projeto cita até 20 contatos. */
export const MAXIMO_DE_CONTATOS_NA_TAREFA = 20;

/**
 * Um jeito de falar com o contato: e-mail, telefone ou rede (o @ ou o endereço do perfil). Um de cada tipo pode ser
 * o principal. O telefone diz se tem WhatsApp (o M8 usa).
 */
export const Identificador = Type.Union(
  [
    Type.Object(
      { tipo: Type.Literal("email"), valor: Email, principal: Type.Boolean() },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        tipo: Type.Literal("telefone"),
        valor: Telefone,
        principal: Type.Boolean(),
        whatsapp: Type.Boolean(),
        rotulo: Type.Optional(OuNulo(Texto(40, "De onde é (ex.: celular, recepção, casa)."))),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        tipo: Type.Literal("rede"),
        rede: Rede,
        valor: Texto(300, "O @ ou o endereço do perfil."),
        principal: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  ],
  { description: "E-mail, telefone ou rede do contato." },
);
export type Identificador = Static<typeof Identificador>;

/** A pessoa ligada a uma organização, com o cargo. */
export const VinculoComOrganizacao = Type.Object(
  {
    organizacaoId: Id,
    cargo: Type.Optional(OuNulo(Texto(120, "O cargo na organização (ex.: Diretora comercial)."))),
  },
  { additionalProperties: false },
);
export type VinculoComOrganizacao = Static<typeof VinculoComOrganizacao>;

const NomeDoContato = Texto(200, "Nome da pessoa ou da organização.");
const Observacoes = Texto(10000, "O que a equipe precisa saber sobre o contato.");
/** CPF da pessoa ou CNPJ da organização, só os dígitos (11 ou 14). */
const Documento = Type.String({
  pattern: "^([0-9]{11}|[0-9]{14})$",
  description: "CPF (11 dígitos) ou CNPJ (14 dígitos), só os números.",
});

export const Contato = Type.Object(
  {
    id: Id,
    empresaId: Id,
    tipo: TipoDeContato,
    nome: NomeDoContato,
    papeis: Type.Array(PapelDeContato, { uniqueItems: true }),
    identificadores: Type.Array(Identificador, { maxItems: MAXIMO_DE_IDENTIFICADORES }),
    /** Só na pessoa: as organizações a que ela está ligada. */
    organizacoes: Type.Array(VinculoComOrganizacao, { maxItems: MAXIMO_DE_ORGANIZACOES }),
    documento: OuNulo(Documento),
    /** As mesmas etiquetas da empresa que marcam as tarefas. */
    etiquetas: Type.Array(Id, { maxItems: MAXIMO_DE_ETIQUETAS_NO_CONTATO }),
    /** A pessoa da equipe que cuida do contato. */
    responsavelId: OuNulo(Id),
    fuso: OuNulo(FusoHorario),
    observacoes: OuNulo(Observacoes),
    situacao: SituacaoDeContato,
    /** No contato juntado: o contato em que ele foi juntado. */
    juntadoEmId: OuNulo(Id),
    criadoPor: Id,
    /** O agente que criou pela ferramenta (a pedido de quem criou), se foi assim. */
    criadoPorAgenteId: OuNulo(Id),
    criadoEm: DataHora,
    atualizadoEm: DataHora,
  },
  { additionalProperties: false, description: "Contato da empresa: uma pessoa ou uma organização de fora." },
);
export type Contato = Static<typeof Contato>;

function problemasDoContato(c: {
  tipo?: TipoDeContato;
  identificadores?: Identificador[];
  organizacoes?: VinculoComOrganizacao[];
}): Problema[] {
  const problemas: Problema[] = [];
  const ids = c.identificadores ?? [];
  const chaves = ids.map((i) => `${i.tipo}:${i.tipo === "rede" ? i.rede : ""}:${i.valor.toLowerCase()}`);
  if (new Set(chaves).size !== chaves.length)
    problemas.push({ caminho: "/identificadores", mensagem: "identificador repetido no mesmo contato" });
  for (const tipo of ["email", "telefone"] as const) {
    if (ids.filter((i) => i.tipo === tipo && i.principal).length > 1)
      problemas.push({ caminho: "/identificadores", mensagem: `só um ${tipo} pode ser o principal` });
  }
  const orgs = c.organizacoes ?? [];
  if (orgs.length > 0 && c.tipo === "organizacao")
    problemas.push({ caminho: "/organizacoes", mensagem: "só a pessoa se liga a organizações" });
  if (new Set(orgs.map((o) => o.organizacaoId)).size !== orgs.length)
    problemas.push({ caminho: "/organizacoes", mensagem: "organização repetida" });
  return problemas;
}

export function conferirContato(valor: unknown) {
  return conferir(Contato, valor, [problemasDoContato]);
}

/** Criar um contato. Sem responsável, fica com quem criou. Sem papel, nasce como "outro". */
export const PedidoDeContato = Type.Object(
  {
    tipo: TipoDeContato,
    nome: NomeDoContato,
    papeis: Type.Optional(Type.Array(PapelDeContato, { uniqueItems: true })),
    identificadores: Type.Optional(Type.Array(Identificador, { maxItems: MAXIMO_DE_IDENTIFICADORES })),
    organizacoes: Type.Optional(Type.Array(VinculoComOrganizacao, { maxItems: MAXIMO_DE_ORGANIZACOES })),
    documento: Type.Optional(OuNulo(Documento)),
    etiquetas: Type.Optional(Type.Array(Id, { maxItems: MAXIMO_DE_ETIQUETAS_NO_CONTATO, uniqueItems: true })),
    responsavelId: Type.Optional(OuNulo(Id)),
    fuso: Type.Optional(OuNulo(FusoHorario)),
    observacoes: Type.Optional(OuNulo(Observacoes)),
  },
  { additionalProperties: false },
);
export type PedidoDeContato = Static<typeof PedidoDeContato>;

export function conferirPedidoDeContato(valor: unknown) {
  return conferir(PedidoDeContato, valor, [problemasDoContato]);
}

/**
 * Editar (só o que veio muda). Identificadores, organizações, papéis e etiquetas vêm sempre completos (a lista
 * nova substitui a antiga). Arquivar e desarquivar é a situação (o contato juntado não volta).
 */
export const PedidoDeEditarContato = Type.Object(
  {
    nome: Type.Optional(NomeDoContato),
    papeis: Type.Optional(Type.Array(PapelDeContato, { uniqueItems: true })),
    identificadores: Type.Optional(Type.Array(Identificador, { maxItems: MAXIMO_DE_IDENTIFICADORES })),
    organizacoes: Type.Optional(Type.Array(VinculoComOrganizacao, { maxItems: MAXIMO_DE_ORGANIZACOES })),
    documento: Type.Optional(OuNulo(Documento)),
    etiquetas: Type.Optional(Type.Array(Id, { maxItems: MAXIMO_DE_ETIQUETAS_NO_CONTATO, uniqueItems: true })),
    responsavelId: Type.Optional(OuNulo(Id)),
    fuso: Type.Optional(OuNulo(FusoHorario)),
    observacoes: Type.Optional(OuNulo(Observacoes)),
    situacao: Type.Optional(Type.Enum(["ativo", "arquivado"] as const)),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarContato = Static<typeof PedidoDeEditarContato>;

export function conferirPedidoDeEditarContato(valor: unknown) {
  return conferir(PedidoDeEditarContato, valor, [problemasDoContato]);
}

/**
 * O aviso de identificador repetido: o e-mail, telefone ou rede já está em outro contato ativo que quem cadastrou
 * pode ver. Não bloqueia; a tela sugere juntar. De um contato que a pessoa não vê, diz só que existe, sem o nome.
 */
export const AvisoDeRepetido = Type.Object(
  {
    identificador: Identificador,
    /** O outro contato, se quem cadastrou pode vê-lo; nulo quando não pode. */
    contatoId: OuNulo(Id),
    nome: OuNulo(NomeDoContato),
  },
  { additionalProperties: false },
);
export type AvisoDeRepetido = Static<typeof AvisoDeRepetido>;

/** A resposta de criar e de editar: o contato e os avisos de repetidos. */
export const ContatoSalvo = Type.Object(
  { contato: Contato, repetidos: Type.Array(AvisoDeRepetido) },
  { additionalProperties: false },
);
export type ContatoSalvo = Static<typeof ContatoSalvo>;

/** Filtro da lista de contatos (também o que a visão salva guarda). */
export const FiltroDeContatos = Type.Object(
  {
    tipo: Type.Optional(TipoDeContato),
    papeis: Type.Optional(Type.Array(PapelDeContato, { minItems: 1, uniqueItems: true })),
    /** Tem pelo menos uma destas etiquetas. */
    etiquetas: Type.Optional(Type.Array(Id, { minItems: 1, maxItems: 20, uniqueItems: true })),
    /** Responsáveis; "sem" para os contatos sem responsável. */
    responsaveis: Type.Optional(
      Type.Array(Type.Union([Id, Type.Literal("sem")]), { minItems: 1, maxItems: 50, uniqueItems: true }),
    ),
    /** As pessoas ligadas a esta organização. */
    organizacaoId: Type.Optional(Id),
    /** Padrão: só os ativos. */
    situacao: Type.Optional(Type.Enum(["ativo", "arquivado"] as const)),
    /** No nome, nos e-mails, telefones e redes e nas observações, sem acento e aceitando erro de digitação. */
    texto: Type.Optional(Type.String({ minLength: 2, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type FiltroDeContatos = Static<typeof FiltroDeContatos>;

/** Visão salva dos contatos (como as das tarefas, M3-04): só de quem salvou. */
export const VisaoDeContatos = Type.Object(
  {
    id: Id,
    empresaId: Id,
    pessoaId: Id,
    nome: Texto(80, "Nome da visão (ex.: Leads da Ana)."),
    filtro: FiltroDeContatos,
    criadaEm: DataHora,
  },
  { additionalProperties: false, description: "Visão dos contatos salva por uma pessoa, só dela." },
);
export type VisaoDeContatos = Static<typeof VisaoDeContatos>;

export const PedidoDeVisaoDeContatos = Type.Object(
  { nome: Texto(80, "Nome da visão (ex.: Leads da Ana)."), filtro: FiltroDeContatos },
  { additionalProperties: false },
);
export type PedidoDeVisaoDeContatos = Static<typeof PedidoDeVisaoDeContatos>;

/**
 * Juntar (só na tela, com a permissão "aprovar" do módulo): o contato "fica" recebe os identificadores, as
 * organizações, os papéis, as etiquetas, as observações (somadas) e as tarefas e projetos do "sai". Os campos
 * que os dois têm ficam com o valor do que fica. O "sai" vira "juntado" e leva ao que fica.
 */
export const PedidoDeJuntar = Type.Object(
  {
    ficaId: Id,
    saiId: Id,
    /** O nome que fica depois de juntar (pedido do Sandro em 27/11/2026). Sem ele, vale o nome do que fica. */
    nome: Type.Optional(NomeDoContato),
  },
  { additionalProperties: false, description: "Juntar dois contatos da mesma empresa." },
);
export type PedidoDeJuntar = Static<typeof PedidoDeJuntar>;

export function conferirPedidoDeJuntar(valor: unknown) {
  return conferir(PedidoDeJuntar, valor, [
    (p): Problema[] =>
      p.ficaId === p.saiId ? [{ caminho: "/saiId", mensagem: "escolha dois contatos diferentes" }] : [],
  ]);
}

/** Os contatos citados numa tarefa ou num projeto (a lista completa substitui a antiga). */
export const PedidoDeContatosLigados = Type.Object(
  { contatos: Type.Array(Id, { maxItems: MAXIMO_DE_CONTATOS_NA_TAREFA, uniqueItems: true }) },
  { additionalProperties: false },
);
export type PedidoDeContatosLigados = Static<typeof PedidoDeContatosLigados>;

/** Um contato na lista e na escolha da tarefa: o resumo, sem as observações nem o documento. */
export const ResumoDoContato = Type.Object(
  {
    id: Id,
    tipo: TipoDeContato,
    nome: NomeDoContato,
    papeis: Type.Array(PapelDeContato),
    emailPrincipal: OuNulo(Email),
    telefonePrincipal: OuNulo(Telefone),
    /** Na pessoa, o nome da primeira organização. */
    organizacao: OuNulo(NomeDoContato),
    etiquetas: Type.Array(Id),
    responsavelId: OuNulo(Id),
    situacao: SituacaoDeContato,
  },
  { additionalProperties: false },
);
export type ResumoDoContato = Static<typeof ResumoDoContato>;

/** Ações de auditoria dos contatos. Nos detalhes vão ids e os campos que mudaram, nunca nome, e-mail ou telefone. */
export const ACOES_CONTATOS = [
  "contato.criou",
  "contato.editou",
  "contato.arquivou",
  "contato.desarquivou",
  "contato.juntou",
  "contato.apagou",
  "contato.ligou_tarefa",
  "contato.ligou_projeto",
] as const;
export type AcaoDosContatos = (typeof ACOES_CONTATOS)[number];
