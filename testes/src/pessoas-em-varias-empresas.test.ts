/**
 * Teste de vazamento do M1-02: a mesma pessoa em duas empresas nunca vê dados de uma na outra.
 * Usa o papel da API (mago_app) contra um banco PostgreSQL de verdade.
 */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa, comPessoa } from "@mago-os/nucleo/empresa";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const C = "00000000-0000-7000-8000-00000000000c"; // suspensa

// Pessoas (todas falsas).
const ANA = "00000000-0000-7000-8000-0000000000a1"; // só na A
const BIA = "00000000-0000-7000-8000-0000000000b1"; // só na B
const DUDA = "00000000-0000-7000-8000-0000000000d1"; // na A e na B, e Dona da plataforma
const EDU = "00000000-0000-7000-8000-0000000000e1"; // desligado da A
const FABI = "00000000-0000-7000-8000-0000000000f1"; // bloqueada, com vínculo ativo na A
const GIL = "00000000-0000-7000-8000-0000000000c1"; // só na C (suspensa)

describe.skipIf(!bancoDisponivel)("uma pessoa em várias empresas", () => {
  let banco: BancoTemporario;
  let app: pg.Pool;

  const ids = async (c: pg.PoolClient, sql: string, valores: unknown[] = []) =>
    (await c.query<{ id: string }>(sql, valores)).rows.map((r) => r.id).sort();

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    const dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    await dono.query(
      `insert into empresas (id, nome, situacao) values
         ($1, 'Empresa A', 'ativa'), ($2, 'Empresa B', 'ativa'), ($3, 'Empresa C', 'suspensa')`,
      [A, B, C],
    );
    await dono.query(
      `insert into pessoas (id, nome, email, situacao) values
         ($1, 'Ana', 'ana@teste.invalid', 'ativa'), ($2, 'Bia', 'bia@teste.invalid', 'ativa'),
         ($3, 'Duda', 'duda@teste.invalid', 'ativa'), ($4, 'Edu', 'edu@teste.invalid', 'ativa'),
         ($5, 'Fabi', 'fabi@teste.invalid', 'bloqueada'), ($6, 'Gil', 'gil@teste.invalid', 'ativa')`,
      [ANA, BIA, DUDA, EDU, FABI, GIL],
    );
    const ativo = "'ativo', now() - interval '2 days', now() - interval '1 day', null";
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em, desligado_em) values
         ($1, $3, 'funcionario', ${ativo}), ($2, $4, 'funcionario', ${ativo}),
         ($1, $5, 'administrador', ${ativo}), ($2, $5, 'administrador', ${ativo}),
         ($1, $6, 'funcionario', 'desligado', now() - interval '2 days', now() - interval '1 day', now()),
         ($1, $7, 'funcionario', ${ativo}), ($8, $9, 'funcionario', ${ativo})`,
      [A, B, ANA, BIA, DUDA, EDU, FABI, C, GIL],
    );
    await dono.query("insert into papeis_plataforma (pessoa_id, papel) values ($1, 'dono')", [DUDA]);
    await dono.end();
    app = new pg.Pool({ connectionString: banco.urlApp, max: 1 });
  });

  afterAll(async () => {
    await app?.end();
    await banco?.apagar();
  });

  it("na empresa A, a Duda vê as pessoas da A e não vê ninguém só da B", async () => {
    const pessoas = await comPessoa(app, DUDA, A, (c) => ids(c, "select id from pessoas"));
    expect(pessoas).toEqual([ANA, DUDA, EDU, FABI].sort());
    expect(pessoas).not.toContain(BIA);
  });

  it("na empresa A, a Duda não acha a Bia nem procurando pelo identificador ou pelo e-mail", async () => {
    const achadas = await comPessoa(app, DUDA, A, (c) =>
      ids(c, "select id from pessoas where id = $1 or email = 'bia@teste.invalid'", [BIA]),
    );
    expect(achadas).toEqual([]);
  });

  it("na empresa A, dos vínculos da B a Duda vê só o dela mesma", async () => {
    const daB = await comPessoa(
      app,
      DUDA,
      A,
      async (c) => (await c.query("select pessoa_id from vinculos where empresa_id = $1", [B])).rows,
    );
    expect(daB).toEqual([{ pessoa_id: DUDA }]);
  });

  it("ao trocar para a B, a Duda passa a ver a Bia e deixa de ver a Ana", async () => {
    const pessoas = await comPessoa(app, DUDA, B, (c) => ids(c, "select id from pessoas"));
    expect(pessoas).toEqual([BIA, DUDA].sort());
  });

  it("a Duda vê as duas empresas onde está ativa, e só elas", async () => {
    const empresas = await comPessoa(app, DUDA, null, (c) => ids(c, "select id from empresas"));
    expect(empresas).toEqual([A, B]);
  });

  it("a Ana não entra na B: o banco ignora a empresa sem vínculo e não mostra nada dela", async () => {
    const resultado = await comPessoa(app, ANA, B, async (c) => ({
      ativa: (await c.query("select empresa_ativa() as e")).rows[0].e,
      pessoas: await ids(c, "select id from pessoas"),
      vinculos: (await c.query("select empresa_id from vinculos")).rows,
      empresas: await ids(c, "select id from empresas"),
    }));
    expect(resultado).toEqual({ ativa: null, pessoas: [ANA], vinculos: [{ empresa_id: A }], empresas: [A] });
  });

  it("ser Dona da plataforma não abre os dados de uma empresa sem vínculo", async () => {
    const resultado = await comPessoa(app, DUDA, C, async (c) => ({
      ativa: (await c.query("select empresa_ativa() as e")).rows[0].e,
      pessoas: await ids(c, "select id from pessoas"),
    }));
    expect(resultado).toEqual({ ativa: null, pessoas: [DUDA] });
  });

  it("pessoa desligada, pessoa bloqueada e empresa suspensa não entram", async () => {
    for (const [pessoa, empresa] of [
      [EDU, A],
      [FABI, A],
      [GIL, C],
    ] as const) {
      const ativa = await comPessoa(app, pessoa, empresa, async (c) => {
        return (await c.query("select empresa_ativa() as e")).rows[0].e;
      });
      expect(ativa, `${pessoa} em ${empresa}`).toBeNull();
    }
  });

  it("só a própria pessoa vê o papel de Dona da plataforma", async () => {
    const daDuda = await comPessoa(
      app,
      DUDA,
      A,
      async (c) => (await c.query("select papel from papeis_plataforma")).rows,
    );
    expect(daDuda).toEqual([{ papel: "dono" }]);
    const daAna = await comPessoa(
      app,
      ANA,
      A,
      async (c) => (await c.query("select * from papeis_plataforma")).rows,
    );
    expect(daAna).toEqual([]);
    const daEmpresa = await comEmpresa(
      app,
      A,
      async (c) => (await c.query("select * from papeis_plataforma")).rows,
    );
    expect(daEmpresa).toEqual([]);
  });

  it("sem pessoa e sem empresa, nada aparece", async () => {
    const contagem = await app.query(
      `select (select count(*) from pessoas)::int as pessoas, (select count(*) from vinculos)::int as vinculos,
              (select count(*) from papeis_plataforma)::int as papeis, (select count(*) from empresas)::int as empresas`,
    );
    expect(contagem.rows[0]).toEqual({ pessoas: 0, vinculos: 0, papeis: 0, empresas: 0 });
  });

  it("a API ainda não grava pessoas, vínculos nem papéis (chega no login e nos convites)", async () => {
    const tentativas = [
      "insert into pessoas (nome, email) values ('X', 'x@teste.invalid')",
      `insert into vinculos (empresa_id, pessoa_id, perfil) values ('${A}', '${BIA}', 'administrador')`,
      `insert into papeis_plataforma (pessoa_id, papel) values ('${ANA}', 'dono')`,
    ];
    for (const sql of tentativas) {
      await expect(
        comPessoa(app, DUDA, A, (c) => c.query(sql)),
        sql,
      ).rejects.toThrow(/row-level security|permission denied/);
    }
    const mudancas = await comPessoa(app, DUDA, A, async (c) => [
      (await c.query("update pessoas set nome = 'invadida'")).rowCount,
      (await c.query("update vinculos set perfil = 'administrador'")).rowCount,
      (await c.query("delete from vinculos")).rowCount,
      (await c.query("delete from papeis_plataforma")).rowCount,
    ]);
    expect(mudancas).toEqual([0, 0, 0, 0]);
  });

  it("a pessoa do pedido vale só dentro da transação: a conexão volta limpa", async () => {
    await comPessoa(app, DUDA, A, (c) => c.query("select 1"));
    const resultado = await app.query("select pessoa_ativa() as pessoa, count(*)::int as total from pessoas");
    expect(resultado.rows[0]).toEqual({ pessoa: null, total: 0 });
  });

  it("recusa um identificador de pessoa que não é UUID", async () => {
    await expect(comPessoa(app, "' or 1=1 --", A, (c) => c.query("select 1"))).rejects.toThrow(/UUID/);
  });
});
