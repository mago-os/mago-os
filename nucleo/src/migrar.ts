/**
 * Migrações do banco (node-pg-migrate). Os arquivos ficam em nucleo/migracoes, numerados, em SQL puro,
 * cada um com a parte de ida ("-- Up Migration") e a de volta ("-- Down Migration").
 *
 * Uso: node src/migrar.ts <subir|voltar> [quantas]
 * Precisa de DATABASE_URL_DONO: o papel dono das tabelas (a API usa outro papel, sem esse poder).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

export const PASTA_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "..", "migracoes");

export async function migrar(
  bancoUrl: string,
  direcao: "up" | "down",
  quantas = direcao === "up" ? Number.POSITIVE_INFINITY : 1,
  avisar: (texto: string) => void = () => {},
): Promise<string[]> {
  const feitas = await runner({
    databaseUrl: bancoUrl,
    dir: PASTA_MIGRACOES,
    direction: direcao,
    count: quantas,
    migrationsTable: "migracoes",
    migrationsSchema: "mago_controle",
    createMigrationsSchema: true,
    checkOrder: true,
    singleTransaction: true,
    log: avisar,
  });
  return feitas.map((m) => m.name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_DONO;
  const comando = process.argv[2];
  if (!url || (comando !== "subir" && comando !== "voltar")) {
    console.error("Uso: DATABASE_URL_DONO=postgres://... node src/migrar.ts <subir|voltar> [quantas]");
    process.exit(1);
  }
  const quantas = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
  const feitas = await migrar(url, comando === "subir" ? "up" : "down", quantas);
  console.log(feitas.length === 0 ? "Nenhuma migração para rodar." : `Migrações: ${feitas.join(", ")}`);
}
