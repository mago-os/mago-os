/**
 * Regras que toda migração precisa cumprir (M0-05). Se uma tabela nova quebrar alguma, o teste barra.
 */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { type Coluna, lerEstrutura, separarMarca, type Tabela } from "@mago-os/nucleo/documentar-banco";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

/**
 * Tabelas sem empresa_id (docs/banco/decisoes.md, seções 3 e 8): empresas é a própria empresa; pessoas e
 * papeis_plataforma valem para o sistema inteiro. A lista é fechada: tabela nova aqui só com aprovação do Sandro.
 */
const SEM_EMPRESA_ID = new Set(["empresas", "pessoas", "papeis_plataforma"]);

describe.skipIf(!bancoDisponivel)("regras do banco", () => {
  let banco: BancoTemporario;
  let cliente: pg.Client;
  let tabelas: Tabela[];
  let colunas: Coluna[];
  let tabelasDasEmpresas: Tabela[];

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    cliente = new pg.Client({ connectionString: banco.urlDono });
    await cliente.connect();
    ({ tabelas, colunas } = await lerEstrutura(cliente));
    // As regras de isolamento por empresa valem para o esquema public. O esquema acesso (login) tem regras próprias.
    tabelasDasEmpresas = tabelas.filter((t) => !t.tabela.includes("."));
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
    const semIsolamento = tabelasDasEmpresas.filter((t) => !t.rls || !t.rlsForcado).map((t) => t.tabela);
    expect(semIsolamento, "use ENABLE e FORCE ROW LEVEL SECURITY").toEqual([]);
  });

  it("todo dado leva a empresa: coluna empresa_id obrigatória apontando para empresas", () => {
    const problemas = tabelasDasEmpresas
      .filter((t) => !SEM_EMPRESA_ID.has(t.tabela))
      .filter((t) => {
        const c = colunas.find((x) => x.tabela === t.tabela && x.coluna === "empresa_id");
        return !c?.obrigatoria || c.tipo !== "uuid" || c.referencia !== "empresas.id";
      })
      .map((t) => t.tabela);
    expect(problemas).toEqual([]);
  });

  it("toda tabela tem política de acesso que usa a empresa ativa (ou a pessoa, nas tabelas sem empresa)", async () => {
    const r = await cliente.query<{ tabela: string; empresa: boolean; pessoa: boolean }>(`
      select c.relname as tabela,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.qual like '%empresa_ativa()%') as empresa,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.qual like '%pessoa_ativa()%') as pessoa
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p')`);
    const problemas = r.rows
      .filter((x) => !(x.empresa || (SEM_EMPRESA_ID.has(x.tabela) && x.pessoa)))
      .map((x) => x.tabela);
    expect(problemas).toEqual([]);
  });

  it("o papel da API não enxerga o esquema do login, e o do login não enxerga as empresas", async () => {
    const r = await cliente.query(`
      select has_schema_privilege('mago_app', 'acesso', 'USAGE') as app_no_acesso,
             has_table_privilege('mago_acesso', 'public.empresas', 'SELECT') as login_nas_empresas,
             has_table_privilege('mago_acesso', 'public.vinculos', 'SELECT') as login_nos_vinculos,
             has_table_privilege('mago_acesso', 'public.pessoas', 'INSERT') as login_cria_pessoas,
             has_table_privilege('mago_acesso', 'public.pessoas', 'DELETE') as login_apaga_pessoas`);
    expect(r.rows[0]).toEqual({
      app_no_acesso: false,
      login_nas_empresas: false,
      login_nos_vinculos: false,
      login_cria_pessoas: false,
      login_apaga_pessoas: false,
    });
    const papel = await cliente.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = 'mago_acesso'",
    );
    expect(papel.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("funções que rodam como dono do banco fixam o search_path", async () => {
    const r = await cliente.query<{ funcao: string }>(`
      select p.proname as funcao from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'acesso', 'auditoria') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(r.rows.map((x) => x.funcao)).toEqual([]);
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
