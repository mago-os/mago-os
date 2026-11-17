/**
 * Verificação da auditoria (M1-09): confere cada corrente no banco e compara com a cópia travada no Backblaze.
 *
 * - Corrente no banco: a impressão digital de cada evento e o elo com o anterior (verificarCorrente, do contrato).
 * - Cópia: cada evento copiado precisa existir no banco igualzinho. Isso pega até quem reescrevesse a corrente
 *   inteira no banco recalculando as impressões digitais, porque a cópia travada não muda.
 *
 * Uso (no servidor, com a configuração da API):
 *   node src/auditoria/verificar.ts [--copias /pasta/com/arquivos.jsonl]
 * Sai com código 1 se encontrar qualquer problema.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { calcularHash, type EventoAuditoria, verificarCorrente } from "@mago-os/contratos";
import pg from "pg";
import { lerCorrente } from "./registrar.ts";

export interface ResultadoDaVerificacao {
  correntes: { corrente: string; eventos: number; integra: boolean; motivo?: string; sequencia?: number }[];
  copia: {
    conferidos: number;
    divergentes: { corrente: string; sequencia: number; motivo: string }[];
  } | null;
  ok: boolean;
}

/** Lê os arquivos de cópia (uma linha JSON por evento). */
export function lerCopias(pasta: string): EventoAuditoria[] {
  const eventos: EventoAuditoria[] = [];
  for (const nome of readdirSync(pasta)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    for (const linha of readFileSync(join(pasta, nome), "utf8").split("\n")) {
      if (linha.trim()) eventos.push(JSON.parse(linha) as EventoAuditoria);
    }
  }
  return eventos;
}

const CORRENTE_DA_PLATAFORMA = "00000000-0000-0000-0000-000000000000";

export async function verificarAuditoria(
  cliente: pg.ClientBase,
  copias: EventoAuditoria[] | null,
): Promise<ResultadoDaVerificacao> {
  const lista = await cliente.query<{ corrente: string }>(
    "select corrente from auditoria.correntes order by corrente",
  );
  const correntes: ResultadoDaVerificacao["correntes"] = [];
  const noBanco = new Map<string, Map<number, EventoAuditoria>>();
  for (const { corrente } of lista.rows) {
    const eventos = await lerCorrente(cliente, corrente);
    noBanco.set(corrente, new Map(eventos.map((e) => [e.sequencia, e])));
    const r = await verificarCorrente(eventos);
    correntes.push(
      r.integra
        ? { corrente, eventos: r.eventos, integra: true }
        : { corrente, eventos: eventos.length, integra: false, motivo: r.motivo, sequencia: r.sequencia },
    );
  }

  let copia: ResultadoDaVerificacao["copia"] = null;
  if (copias) {
    const divergentes: { corrente: string; sequencia: number; motivo: string }[] = [];
    for (const copiado of copias) {
      const corrente = copiado.empresaId ?? CORRENTE_DA_PLATAFORMA;
      const { hash: _h, ...semHash } = copiado;
      if ((await calcularHash(semHash)) !== copiado.hash) {
        divergentes.push({
          corrente,
          sequencia: copiado.sequencia,
          motivo: "a cópia não confere com ela mesma",
        });
        continue;
      }
      const atual = noBanco.get(corrente)?.get(copiado.sequencia);
      if (!atual) divergentes.push({ corrente, sequencia: copiado.sequencia, motivo: "sumiu do banco" });
      else if (atual.hash !== copiado.hash || atual.id !== copiado.id) {
        divergentes.push({ corrente, sequencia: copiado.sequencia, motivo: "diferente da cópia travada" });
      }
    }
    copia = { conferidos: copias.length, divergentes };
  }

  const ok = correntes.every((c) => c.integra) && (copia === null || copia.divergentes.length === 0);
  return { correntes, copia, ok };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { copias: { type: "string" } } });
  const url = process.env.DATABASE_URL_DONO;
  if (!url) {
    console.error("Uso: DATABASE_URL_DONO=postgres://... node src/auditoria/verificar.ts [--copias pasta]");
    process.exit(1);
  }
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const r = await verificarAuditoria(cliente, values.copias ? lerCopias(values.copias) : null);
    const eventos = r.correntes.reduce((t, c) => t + c.eventos, 0);
    console.log(JSON.stringify({ ...r, resumo: `${r.correntes.length} correntes, ${eventos} eventos` }));
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await cliente.end();
  }
}
