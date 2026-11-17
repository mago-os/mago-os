/**
 * Módulos que existem hoje e o que cada um declara (contrato DeclaracaoDeModulo). Os módulos de negócio
 * (CRM, financeiro...) entram aqui quando forem construídos, cada um com a sua área.
 */
import { conferirDeclaracaoDeModulo, type DeclaracaoDeModulo } from "@mago-os/contratos";

export const MODULOS_DO_NUCLEO: readonly DeclaracaoDeModulo[] = [
  {
    id: "pessoas",
    nome: "Pessoas da empresa",
    acoes: ["ver", "criar", "editar", "excluir"],
    temDadosSensiveis: true,
    area: null,
  },
  { id: "permissoes", nome: "Permissões", acoes: ["ver", "editar"], temDadosSensiveis: false, area: null },
  { id: "auditoria", nome: "Auditoria", acoes: ["ver"], temDadosSensiveis: true, area: null },
];

/** Catálogo de módulos. Recusa na subida uma declaração fora do contrato ou um id repetido. */
export function catalogoDeModulos(modulos: readonly DeclaracaoDeModulo[] = MODULOS_DO_NUCLEO) {
  const mapa = new Map<string, DeclaracaoDeModulo>();
  for (const modulo of modulos) {
    const r = conferirDeclaracaoDeModulo(modulo);
    if (!r.ok)
      throw new Error(
        `Módulo ${modulo.id} fora do contrato: ${r.problemas.map((p) => p.mensagem).join("; ")}`,
      );
    if (mapa.has(modulo.id)) throw new Error(`Módulo repetido: ${modulo.id}`);
    mapa.set(modulo.id, modulo);
  }
  return mapa;
}
