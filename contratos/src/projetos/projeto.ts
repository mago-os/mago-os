/**
 * Espaço e projeto (M3-01): como a empresa organiza o trabalho, no estilo do plano (espaço > projeto > lista >
 * tarefa). Listas e status por projeto vêm na M3-02.
 *
 * Decisões do Sandro (19/11/2026, spec M3-projetos):
 * 1. Administrador e gestor veem todos os projetos; o funcionário vê só os projetos em que é membro.
 * 2. O projeto é opcional na tarefa: sem projeto, a tarefa aparece como "Sem projeto".
 *
 * Cada projeto tem um diretor (sempre uma pessoa, dona das decisões) e, se quiser, um gerente (pessoa ou
 * agente, que cuida da rotina). Os dois são membros do projeto automaticamente. No M3 o gerente agente é só o
 * papel: planejar e acompanhar sozinho vem com os agentes internos (M4).
 */
import { type Static, Type } from "typebox";
import { Cor, conferir, DataHora, Dia, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";
import { Responsavel } from "../tarefas/tarefa.ts";

export { Cor, Dia };

export const SITUACOES_DE_ORGANIZACAO = ["ativo", "arquivado"] as const;
/** Arquivar esconde das listas sem apagar nada; dá para desarquivar. */
export const SituacaoDeOrganizacao = Type.Enum(SITUACOES_DE_ORGANIZACAO, {
  description: "ativo ou arquivado (escondido das listas, sem apagar nada).",
});
export type SituacaoDeOrganizacao = Static<typeof SituacaoDeOrganizacao>;

const NomeDoEspaco = Texto(80, "Nome do espaço (ex.: Operações, Comercial).");
const NomeDoProjeto = Texto(120, "Nome do projeto (ex.: Construção do Mago OS).");
const Descricao = Texto(5000, "Para que serve, em poucas linhas.");

export const Espaco = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: NomeDoEspaco,
    descricao: OuNulo(Descricao),
    cor: Cor,
    situacao: SituacaoDeOrganizacao,
    criadoEm: DataHora,
    atualizadoEm: DataHora,
  },
  { additionalProperties: false, description: "Espaço da empresa: agrupa projetos de uma área ou frente." },
);
export type Espaco = Static<typeof Espaco>;

export function conferirEspaco(valor: unknown) {
  return conferir(Espaco, valor);
}

/** Papel de alguém no projeto. Diretor e gerente também contam como membros. */
export const PAPEIS_NO_PROJETO = ["diretor", "gerente", "membro"] as const;
export const PapelNoProjeto = Type.Enum(PAPEIS_NO_PROJETO, {
  description: "diretor (pessoa, dono das decisões), gerente (pessoa ou agente, cuida da rotina) ou membro.",
});
export type PapelNoProjeto = Static<typeof PapelNoProjeto>;

/** Quem faz parte do projeto: uma pessoa ou um agente da mesma empresa, com o papel. */
export const MembroDoProjeto = Type.Object(
  { quem: Responsavel, papel: PapelNoProjeto },
  { additionalProperties: false },
);
export type MembroDoProjeto = Static<typeof MembroDoProjeto>;

export const Projeto = Type.Object(
  {
    id: Id,
    empresaId: Id,
    espacoId: Id,
    nome: NomeDoProjeto,
    descricao: OuNulo(Descricao),
    cor: Cor,
    situacao: SituacaoDeOrganizacao,
    /** O diretor é sempre uma pessoa da empresa. */
    diretorId: Id,
    gerente: OuNulo(Responsavel),
    /** Todos os membros, incluindo o diretor e o gerente, cada um uma vez só. */
    membros: Type.Array(MembroDoProjeto, { maxItems: 500 }),
    /** O gerente recebe as tarefas do projeto que ficaram sem responsável (opção do diretor). */
    gerenteRecebeSemResponsavel: Type.Boolean(),
    inicio: OuNulo(Dia),
    fim: OuNulo(Dia),
    criadoEm: DataHora,
    atualizadoEm: DataHora,
  },
  {
    additionalProperties: false,
    description: "Projeto dentro de um espaço, com diretor, gerente e membros.",
  },
);
export type Projeto = Static<typeof Projeto>;

const chave = (r: Responsavel) => (r.tipo === "pessoa" ? `p:${r.pessoaId}` : `a:${r.agenteId}`);

export const regrasDoProjeto: Regra<Projeto>[] = [
  (p) => {
    const problemas: Problema[] = [];
    const vistos = new Set<string>();
    for (const m of p.membros) {
      if (vistos.has(chave(m.quem))) problemas.push({ caminho: "/membros", mensagem: "membro repetido" });
      vistos.add(chave(m.quem));
    }
    const [diretor, ...outrosDiretores] = p.membros.filter((m) => m.papel === "diretor");
    if (!diretor || outrosDiretores.length > 0 || chave(diretor.quem) !== `p:${p.diretorId}`) {
      problemas.push({ caminho: "/membros", mensagem: "o diretor é um membro só, com o papel diretor" });
    }
    const [gerente, ...outrosGerentes] = p.membros.filter((m) => m.papel === "gerente");
    const gerenteCerto =
      outrosGerentes.length === 0 &&
      (p.gerente === null ? !gerente : gerente !== undefined && chave(gerente.quem) === chave(p.gerente));
    if (!gerenteCerto) {
      problemas.push({ caminho: "/membros", mensagem: "o gerente é um membro só, com o papel gerente" });
    }
    return problemas;
  },
  (p) =>
    p.gerenteRecebeSemResponsavel && p.gerente === null
      ? [
          {
            caminho: "/gerenteRecebeSemResponsavel",
            mensagem: "precisa de um gerente para receber as tarefas",
          },
        ]
      : [],
  (p) =>
    p.inicio !== null && p.fim !== null && p.fim < p.inicio
      ? [{ caminho: "/fim", mensagem: "o fim vem depois do início" }]
      : [],
];

export function conferirProjeto(valor: unknown) {
  return conferir(Projeto, valor, regrasDoProjeto);
}

/** Criar um espaço (só o administrador). */
export const PedidoDeEspaco = Type.Object(
  { nome: NomeDoEspaco, descricao: Type.Optional(OuNulo(Descricao)), cor: Type.Optional(Cor) },
  { additionalProperties: false },
);
export type PedidoDeEspaco = Static<typeof PedidoDeEspaco>;

/** Editar um espaço: só o que veio muda. */
export const PedidoDeEditarEspaco = Type.Object(
  {
    nome: Type.Optional(NomeDoEspaco),
    descricao: Type.Optional(OuNulo(Descricao)),
    cor: Type.Optional(Cor),
    situacao: Type.Optional(SituacaoDeOrganizacao),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarEspaco = Static<typeof PedidoDeEditarEspaco>;

/** Criar um projeto (administrador e gestor). Sem diretor, quem cria é o diretor. */
export const PedidoDeProjeto = Type.Object(
  {
    espacoId: Id,
    nome: NomeDoProjeto,
    descricao: Type.Optional(OuNulo(Descricao)),
    cor: Type.Optional(Cor),
    diretorId: Type.Optional(Id),
    gerente: Type.Optional(OuNulo(Responsavel)),
    membros: Type.Optional(Type.Array(Responsavel, { maxItems: 500 })),
    gerenteRecebeSemResponsavel: Type.Optional(Type.Boolean()),
    inicio: Type.Optional(OuNulo(Dia)),
    fim: Type.Optional(OuNulo(Dia)),
  },
  { additionalProperties: false },
);
export type PedidoDeProjeto = Static<typeof PedidoDeProjeto>;

/** Editar um projeto (o diretor, o administrador e o gestor): só o que veio muda. */
export const PedidoDeEditarProjeto = Type.Object(
  {
    espacoId: Type.Optional(Id),
    nome: Type.Optional(NomeDoProjeto),
    descricao: Type.Optional(OuNulo(Descricao)),
    cor: Type.Optional(Cor),
    situacao: Type.Optional(SituacaoDeOrganizacao),
    diretorId: Type.Optional(Id),
    gerente: Type.Optional(OuNulo(Responsavel)),
    /** A lista completa de membros comuns (sem o diretor e o gerente, que entram sozinhos). */
    membros: Type.Optional(Type.Array(Responsavel, { maxItems: 500 })),
    gerenteRecebeSemResponsavel: Type.Optional(Type.Boolean()),
    inicio: Type.Optional(OuNulo(Dia)),
    fim: Type.Optional(OuNulo(Dia)),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarProjeto = Static<typeof PedidoDeEditarProjeto>;

/** Mudar a tarefa de projeto, ou tirar de projeto (nulo). Vai para a auditoria. */
export const PedidoDeMudarProjeto = Type.Object({ projetoId: OuNulo(Id) }, { additionalProperties: false });
export type PedidoDeMudarProjeto = Static<typeof PedidoDeMudarProjeto>;

/** Ações de auditoria de espaços e projetos (M3-01). Nos detalhes vão ids, nunca nomes ou descrições. */
export const ACOES_PROJETOS = [
  "espaco.criou",
  "espaco.editou",
  "espaco.arquivou",
  "projeto.criou",
  "projeto.editou",
  "projeto.arquivou",
  "projeto.excluiu",
  "projeto.trocou_diretor",
  "projeto.trocou_gerente",
  "projeto.mudou_membros",
  "tarefa.mudou_projeto",
] as const;
