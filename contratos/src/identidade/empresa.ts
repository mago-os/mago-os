/** Empresa: cada empresa só enxerga os próprios dados (Row Level Security, docs/banco/decisoes.md). */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, Texto } from "../comum.ts";

export const SITUACOES_EMPRESA = ["ativa", "suspensa"] as const;

/** ativa: funciona normalmente. suspensa: ninguém da empresa entra (planos e cobrança ficam para a Fase 2). */
export const SituacaoEmpresa = Type.Enum(SITUACOES_EMPRESA, {
  description: "ativa: funciona normalmente. suspensa: ninguém da empresa entra.",
});

export const Empresa = Type.Object(
  {
    id: Id,
    nome: Texto(200, "Nome da empresa como aparece no sistema."),
    situacao: SituacaoEmpresa,
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Empresa que usa o Mago OS." },
);
export type Empresa = Static<typeof Empresa>;

export function conferirEmpresa(valor: unknown) {
  return conferir(Empresa, valor);
}
