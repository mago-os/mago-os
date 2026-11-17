/**
 * Permissões (M1-06): o que cada pessoa pode fazer em cada módulo da empresa, e até onde.
 *
 * Três camadas (plano, "Níveis de acesso"):
 * 1. Perfil (administrador, gestor de área, funcionário): o ponto de partida.
 * 2. Ajuste por módulo, por pessoa: o administrador muda uma ação e o alcance dela.
 * 3. Dados sensíveis: só aparecem para quem tem "ver_sensiveis" naquele módulo.
 *
 * Cada módulo declara aqui o que tem (DeclaracaoDeModulo); o núcleo calcula e confere (nucleo/src/permissoes).
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, type Problema, type Regra, Texto } from "./comum.ts";
import { Area } from "./identidade/vinculo.ts";

export const ACOES_NO_MODULO = ["ver", "criar", "editar", "aprovar", "excluir"] as const;
export const AcaoNoModulo = Type.Enum(ACOES_NO_MODULO, { description: "O que se faz no módulo." });
export type AcaoNoModulo = Static<typeof AcaoNoModulo>;

/** Do menor para o maior: nada < meus itens < da minha equipe < tudo. */
export const ALCANCES = ["nada", "meus", "equipe", "tudo"] as const;
export const Alcance = Type.Enum(ALCANCES, {
  description: "nada: não pode. meus: só os próprios itens. equipe: os da área. tudo: todos da empresa.",
});
export type Alcance = Static<typeof Alcance>;

/** Ajuste pode mexer numa ação ou na liberação de dados sensíveis do módulo. */
export const ACOES_AJUSTAVEIS = [...ACOES_NO_MODULO, "ver_sensiveis"] as const;
export const AcaoAjustavel = Type.Enum(ACOES_AJUSTAVEIS);
export type AcaoAjustavel = Static<typeof AcaoAjustavel>;

/** Identificador de módulo, em minúsculas (ex.: crm, financeiro, pessoas). */
export const IdDeModulo = Type.String({ pattern: "^[a-z][a-z0-9_]{1,39}$" });

/** O que cada módulo declara ao núcleo. */
export const DeclaracaoDeModulo = Type.Object(
  {
    id: IdDeModulo,
    nome: Texto(80, "Nome do módulo como aparece nas telas."),
    acoes: Type.Array(AcaoNoModulo, { minItems: 1, uniqueItems: true }),
    /** O módulo tem campos marcados como sensíveis (salário, financeiro, dados pessoais). */
    temDadosSensiveis: Type.Boolean(),
    /** Área a que o módulo pertence (ex.: crm é do comercial). Nulo: módulo do núcleo, sem área. */
    area: Type.Union([Area, Type.Null()]),
  },
  { additionalProperties: false },
);
export type DeclaracaoDeModulo = Static<typeof DeclaracaoDeModulo>;

/** Ajuste de permissão de uma pessoa numa empresa (feito pelo administrador). */
export const AjusteDePermissao = Type.Object(
  {
    vinculoId: Id,
    modulo: IdDeModulo,
    acao: AcaoAjustavel,
    alcance: Alcance,
    feitoPor: Id,
    feitoEm: DataHora,
  },
  { additionalProperties: false },
);
export type AjusteDePermissao = Static<typeof AjusteDePermissao>;

export const regrasDoAjuste: Regra<AjusteDePermissao>[] = [
  (a): Problema[] =>
    a.acao === "ver_sensiveis" && a.alcance !== "nada" && a.alcance !== "tudo"
      ? [{ caminho: "/alcance", mensagem: "dados sensíveis são liberados ou não (tudo ou nada)" }]
      : [],
];

export function conferirAjusteDePermissao(valor: unknown) {
  return conferir(AjusteDePermissao, valor, regrasDoAjuste);
}

export function conferirDeclaracaoDeModulo(valor: unknown) {
  return conferir(DeclaracaoDeModulo, valor);
}

/** O que a pessoa pode num módulo: o alcance de cada ação e se vê os dados sensíveis. */
export interface PermissaoNoModulo {
  acoes: Record<AcaoNoModulo, Alcance>;
  verSensiveis: boolean;
}

/** O que a API recebe para ajustar uma permissão (PUT /empresa/permissoes). */
export const PedidoDeAjusteDePermissao = Type.Object(
  { vinculoId: Id, modulo: IdDeModulo, acao: AcaoAjustavel, alcance: Alcance },
  { additionalProperties: false },
);
export type PedidoDeAjusteDePermissao = Static<typeof PedidoDeAjusteDePermissao>;

export function conferirPedidoDeAjuste(valor: unknown) {
  return conferir(PedidoDeAjusteDePermissao, valor, [
    (a): Problema[] =>
      a.acao === "ver_sensiveis" && a.alcance !== "nada" && a.alcance !== "tudo"
        ? [{ caminho: "/alcance", mensagem: "dados sensíveis são liberados ou não (tudo ou nada)" }]
        : [],
  ]);
}
