/**
 * Teste de vazamento (M0-05): uma empresa nunca pode ver nem alterar os dados de outra.
 * Usa o papel da API (mago_app) contra um banco PostgreSQL de verdade.
 */

import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";

describe.skipIf(!bancoDisponivel)("isolamento entre empresas", () => {
  let banco: BancoTemporario;
  let app: pg.Pool;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    const dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    await dono.query("insert into empresas (id, nome) values ($1, 'Empresa A'), ($2, 'Empresa B')", [A, B]);
    await dono.end();
    app = new pg.Pool({ connectionString: banco.urlApp, max: 1 });
  });

  afterAll(async () => {
    await app?.end();
    await banco?.apagar();
  });

  it("a empresa A vê só a própria linha", async () => {
    const linhas = await comEmpresa(
      app,
      A,
      async (c) => (await c.query("select id, nome from empresas")).rows,
    );
    expect(linhas).toEqual([{ id: A, nome: "Empresa A" }]);
  });

  it("a empresa A não acha a empresa B nem procurando pelo identificador", async () => {
    const linhas = await comEmpresa(
      app,
      A,
      async (c) => (await c.query("select * from empresas where id = $1", [B])).rows,
    );
    expect(linhas).toEqual([]);
  });

  it("sem empresa informada, nada aparece", async () => {
    const resultado = await app.query("select * from empresas");
    expect(resultado.rows).toEqual([]);
  });

  it("a empresa A não consegue alterar a empresa B", async () => {
    const alteradas = await comEmpresa(app, A, async (c) => {
      const r = await c.query("update empresas set nome = 'invadida' where id = $1", [B]);
      return r.rowCount;
    });
    expect(alteradas).toBe(0);
  });

  it("a empresa A não consegue mudar a própria linha para virar outra empresa", async () => {
    await expect(
      comEmpresa(app, A, (c) => c.query("update empresas set id = $1 where id = $2", [B, A])),
    ).rejects.toThrow();
  });

  it("a API não consegue criar nem apagar empresas", async () => {
    await expect(
      comEmpresa(app, A, (c) => c.query("insert into empresas (nome) values ('Nova')")),
    ).rejects.toThrow(/row-level security|permission denied/);
    const apagadas = await comEmpresa(app, A, async (c) => (await c.query("delete from empresas")).rowCount);
    expect(apagadas).toBe(0);
  });

  it("a empresa ativa vale só dentro da transação: a conexão volta limpa", async () => {
    await comEmpresa(app, A, (c) => c.query("select 1"));
    // O pool tem uma conexão só, então esta consulta usa a mesma conexão do pedido anterior.
    const resultado = await app.query(
      "select empresa_ativa() as ativa, count(*)::int as total from empresas",
    );
    expect(resultado.rows[0]).toEqual({ ativa: null, total: 0 });
  });

  it("a API não consegue desligar o isolamento", async () => {
    await expect(app.query("alter table empresas disable row level security")).rejects.toThrow(
      /owner|permission/,
    );
    await expect(app.query("set row_security = off; select * from empresas")).rejects.toThrow();
  });

  it("recusa um identificador de empresa que não é UUID", async () => {
    await expect(comEmpresa(app, "' or 1=1 --", (c) => c.query("select 1"))).rejects.toThrow(/UUID/);
  });
});
