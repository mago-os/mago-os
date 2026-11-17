/**
 * Exporta os eventos de auditoria ainda não copiados (M1-09), para o script da VPS02 mandar ao depósito travado.
 *
 *   node src/auditoria/exportar.ts /saida/lote.jsonl   (até 1000 eventos por vez)
 *
 * Grava o lote (uma linha JSON por evento, no formato do contrato) e, ao lado, lote.ids com os identificadores.
 * Só depois que o envio der certo, o script marca os eventos como copiados (copiado_em). Escreve na saída padrão
 * quantos eventos foram exportados.
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { linhaParaEvento } from "./registrar.ts";

export const TAMANHO_DO_LOTE = 1000;

export async function exportarPendentes(cliente: pg.ClientBase, limite = TAMANHO_DO_LOTE) {
  const r = await cliente.query(
    `select id, empresa_id, sequencia, ator, acao, alvo, origem, ocorrido_em, rastreio, detalhes, hash_anterior, hash
       from auditoria.eventos where copiado_em is null order by corrente, sequencia limit $1`,
    [limite],
  );
  return r.rows.map(linhaParaEvento);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const destino = process.argv[2];
  const url = process.env.DATABASE_URL_DONO;
  if (!destino || !url) {
    console.error("Uso: DATABASE_URL_DONO=postgres://... node src/auditoria/exportar.ts /saida/lote.jsonl");
    process.exit(1);
  }
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const eventos = await exportarPendentes(cliente);
    if (eventos.length > 0) {
      writeFileSync(destino, `${eventos.map((e) => JSON.stringify(e)).join("\n")}\n`);
      writeFileSync(destino.replace(/\.jsonl$/, ".ids"), `${eventos.map((e) => e.id).join("\n")}\n`);
    }
    console.log(eventos.length);
  } finally {
    await cliente.end();
  }
}
