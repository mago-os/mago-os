/**
 * Toda migração tem caminho de volta (M0-05): sobe tudo, volta tudo e sobe de novo, sem erro.
 */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { migrar } from "@mago-os/nucleo/migrar";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

async function tabelasPublicas(url: string): Promise<string[]> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const r = await cliente.query("select tablename from pg_tables where schemaname = 'public' order by 1");
    return r.rows.map((x) => x.tablename as string);
  } finally {
    await cliente.end();
  }
}

describe.skipIf(!bancoDisponivel)("migrações", () => {
  let banco: BancoTemporario;

  beforeAll(async () => {
    banco = await criarBancoTemporario({ migrar: false });
  });

  afterAll(async () => {
    await banco?.apagar();
  });

  it("sobem, voltam por completo e sobem de novo", async () => {
    const subiram = await migrar(banco.urlDono, "up");
    expect(subiram.length).toBeGreaterThan(0);
    const depoisDeSubir = await tabelasPublicas(banco.urlDono);

    const voltaram = await migrar(banco.urlDono, "down", Number.POSITIVE_INFINITY);
    expect(voltaram).toEqual([...subiram].reverse());
    expect(await tabelasPublicas(banco.urlDono)).toEqual([]);

    await migrar(banco.urlDono, "up");
    expect(await tabelasPublicas(banco.urlDono)).toEqual(depoisDeSubir);
  });
});
