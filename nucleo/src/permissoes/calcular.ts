/**
 * Cálculo das permissões (M1-06): perfil + ajustes = o que a pessoa pode em cada módulo.
 * Função pura, sem banco: fácil de testar e igual para a API, o MCP e os agentes (M2).
 * Ver docs/decisoes/0012-permissoes.md.
 */
import {
  ACOES_NO_MODULO,
  type AcaoAjustavel,
  type AcaoNoModulo,
  type Alcance,
  type DeclaracaoDeModulo,
  type Perfil,
  type PermissaoNoModulo,
} from "@mago-os/contratos";

export interface VinculoParaPermissao {
  perfil: Perfil;
  area: string | null;
}

export interface Ajuste {
  modulo: string;
  acao: AcaoAjustavel;
  alcance: Alcance;
}

/** Padrão dos módulos do núcleo (sem área) para quem não é administrador. */
const PADRAO_DO_NUCLEO: Record<
  "gestor_area" | "funcionario",
  Record<string, Partial<Record<AcaoNoModulo, Alcance>>>
> = {
  gestor_area: {
    pessoas: { ver: "equipe" },
    tarefas: { ver: "equipe", criar: "equipe", editar: "equipe" },
    agentes: { ver: "tudo" },
  },
  funcionario: {
    pessoas: { ver: "meus" },
    tarefas: { ver: "meus", criar: "meus", editar: "meus" },
    agentes: { ver: "tudo" },
  },
};

function nada(): Record<AcaoNoModulo, Alcance> {
  return Object.fromEntries(ACOES_NO_MODULO.map((a) => [a, "nada"])) as Record<AcaoNoModulo, Alcance>;
}

/** O ponto de partida pelo perfil (camada 1). */
export function padraoDoPerfil(vinculo: VinculoParaPermissao, modulo: DeclaracaoDeModulo): PermissaoNoModulo {
  const acoes = nada();
  const declaradas = new Set(modulo.acoes);
  const dar = (acao: AcaoNoModulo, alcance: Alcance) => {
    if (declaradas.has(acao)) acoes[acao] = alcance;
  };

  if (vinculo.perfil === "administrador") {
    for (const acao of modulo.acoes) acoes[acao] = "tudo";
    return { acoes, verSensiveis: modulo.temDadosSensiveis };
  }

  if (modulo.area === null) {
    for (const [acao, alcance] of Object.entries(PADRAO_DO_NUCLEO[vinculo.perfil][modulo.id] ?? {})) {
      dar(acao as AcaoNoModulo, alcance);
    }
  } else if (vinculo.area !== null && modulo.area === vinculo.area) {
    if (vinculo.perfil === "gestor_area") {
      for (const acao of modulo.acoes) dar(acao, "equipe");
    } else {
      dar("ver", "meus");
      dar("criar", "meus");
      dar("editar", "meus");
    }
  }
  return { acoes, verSensiveis: false };
}

/**
 * Perfil + ajustes do administrador (camada 2) + dados sensíveis (camada 3). Ajustes não valem para o
 * administrador: ele vê e faz tudo na empresa, e assim ninguém tranca a empresa fora dela mesma.
 */
export function permissaoNoModulo(
  vinculo: VinculoParaPermissao,
  modulo: DeclaracaoDeModulo,
  ajustes: readonly Ajuste[],
): PermissaoNoModulo {
  const base = padraoDoPerfil(vinculo, modulo);
  if (vinculo.perfil === "administrador") return base;
  const declaradas = new Set<string>(modulo.acoes);
  for (const ajuste of ajustes) {
    if (ajuste.modulo !== modulo.id) continue;
    if (ajuste.acao === "ver_sensiveis") {
      if (modulo.temDadosSensiveis) base.verSensiveis = ajuste.alcance === "tudo";
    } else if (declaradas.has(ajuste.acao)) {
      base.acoes[ajuste.acao] = ajuste.alcance;
    }
  }
  return base;
}

export type Filtro =
  | { tipo: "tudo" }
  | { tipo: "equipe"; area: string; pessoaId: string }
  | { tipo: "meus"; pessoaId: string };

/** Transforma o alcance em filtro de consulta. Equipe sem área vira "só os meus". */
export function filtroDoAlcance(alcance: Alcance, pessoaId: string, area: string | null): Filtro | null {
  if (alcance === "nada") return null;
  if (alcance === "tudo") return { tipo: "tudo" };
  if (alcance === "equipe" && area !== null) return { tipo: "equipe", area, pessoaId };
  return { tipo: "meus", pessoaId };
}
