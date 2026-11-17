/**
 * Papel na plataforma: fica acima das empresas, não dentro delas.
 * Na Fase 1 só existe o Dono da plataforma (o Sandro). O revendedor entra aqui na Fase 2.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id } from "../comum.ts";

export const PAPEIS_PLATAFORMA = ["dono"] as const;

export const PapelPlataforma = Type.Enum(PAPEIS_PLATAFORMA, {
  description: "dono: Dono da plataforma, acima de todas as empresas.",
});

export const PapelNaPlataforma = Type.Object(
  {
    pessoaId: Id,
    papel: PapelPlataforma,
    concedidoEm: DataHora,
  },
  { additionalProperties: false, description: "Papel de uma pessoa acima das empresas." },
);
export type PapelNaPlataforma = Static<typeof PapelNaPlataforma>;

export function conferirPapelNaPlataforma(valor: unknown) {
  return conferir(PapelNaPlataforma, valor);
}
