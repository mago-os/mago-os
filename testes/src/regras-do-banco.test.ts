/**
 * Regras que toda migração precisa cumprir (M0-05). Se uma tabela nova quebrar alguma, o teste barra.
 */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { type Coluna, lerEstrutura, separarMarca, type Tabela } from "@mago-os/nucleo/documentar-banco";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

/** A tabela de empresas é a única sem empresa_id: ela é a própria empresa. */
const SEM_EMPRESA_ID = new Set(["empresas"]);

describe.skipIf(!bancoDisponivel)("regras do banco", () => {
  let banco: BancoTemporario;
  let cliente: pg.Client;
  let tabelas: Tabela[];
  let colunas: Coluna[];

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    cliente = new pg.Client({ connectionString: banco.urlDono });
    await cliente.connect();
    ({ tabelas, colunas } = await lerEstrutura(cliente));
  });

  afterAll(async () => {
    await cliente?.end();
    await banco?.apagar();
  });

  it("toda tabela tem descrição em português", () => {
    const semDescricao = tabelas.filter((t) => !t.descricao?.trim()).map((t) => t.tabela);
    expect(semDescricao, "tabelas sem COMMENT ON TABLE").toEqual([]);
  });

  it("toda coluna tem descrição e uma das marcas [empresa], [pessoal], [sensivel] ou [sistema]", () => {
    const problemas = colunas
      .filter((c) => {
        const { marca, texto } = separarMarca(c.descricao);
        return marca === null || texto.trim().length < 3;
      })
      .map((c) => `${c.tabela}.${c.coluna}`);
    expect(problemas, "colunas sem descrição ou sem marca (ver docs/banco/decisoes.md)").toEqual([]);
  });

  it("toda tabela tem o isolamento por empresa ligado e forçado", () => {
    const semIsolamento = tabelas.filter((t) => !t.rls || !t.rlsForcado).map((t) => t.tabela);
    expect(semIsolamento, "use ENABLE e FORCE ROW LEVEL SECURITY").toEqual([]);
  });

  it("todo dado leva a empresa: coluna empresa_id obrigatória apontando para empresas", () => {
    const problemas = tabelas
      .filter((t) => !SEM_EMPRESA_ID.has(t.tabela))
      .filter((t) => {
        const c = colunas.find((x) => x.tabela === t.tabela && x.coluna === "empresa_id");
        return !c?.obrigatoria || c.tipo !== "uuid" || c.referencia !== "empresas.id";
      })
      .map((t) => t.tabela);
    expect(problemas).toEqual([]);
  });

  it("toda tabela tem política de acesso que usa a empresa ativa", async () => {
    const r = await cliente.query<{ tabela: string }>(`
      select c.relname as tabela
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p')
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname
                            and p.qual like '%empresa_ativa()%')`);
    expect(r.rows.map((x) => x.tabela)).toEqual([]);
  });

  it("o papel da API não é dono de nenhuma tabela e não pode ignorar o isolamento", async () => {
    const papel = await cliente.query(
      "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'mago_app'",
    );
    expect(papel.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const donas = await cliente.query(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = 'mago_app'",
    );
    expect(donas.rows).toEqual([]);
  });
});
