/**
 * Auditoria à prova de alteração (M1-09), contra um PostgreSQL de verdade.
 */
import { verificarCorrente } from "@mago-os/contratos";
import {
  exportarPendentes,
  lerCorrente,
  registrarEvento,
  verificarAuditoria,
} from "@mago-os/nucleo/auditoria";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const PLATAFORMA = "00000000-0000-0000-0000-000000000000";
const PESSOA = "00000000-0000-7000-8000-0000000000a1";

describe.skipIf(!bancoDisponivel)("auditoria à prova de alteração", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let app: pg.Pool;
  let acesso: pg.Pool;

  const evento = (
    empresaId: string | null,
    acao = "acesso.entrou",
    detalhes: Record<string, unknown> = {},
  ) => ({
    empresaId,
    ator: { tipo: "pessoa" as const, pessoaId: PESSOA },
    acao,
    origem: { canal: "painel" as const, ip: "203.0.113.10", aparelho: "Chrome no Mac" },
    detalhes,
  });

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    await dono.query("insert into empresas (id, nome) values ($1, 'Empresa A'), ($2, 'Empresa B')", [A, B]);
    app = new pg.Pool({ connectionString: banco.urlApp, max: 3 });
    acesso = new pg.Pool({ connectionString: banco.urlAcesso, max: 10 });
    // Ao apagar o banco de teste (drop ... with force), uma conexão que ainda estava fechando recebe "terminating
    // connection". Sem estes ouvintes, o Vitest conta isso como erro solto e o teste fica instável.
    for (const pool of [app, acesso]) pool.on("error", () => {});
  });

  afterAll(async () => {
    await app?.end();
    await acesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("grava em correntes separadas (empresa e plataforma), e cada corrente fecha", async () => {
    await registrarEvento(acesso, evento(A, "acesso.entrou", { metodo: "passkey" }));
    await registrarEvento(acesso, evento(A, "sessao.encerrou"));
    await registrarEvento(app, evento(A, "permissao.alterou", { modulo: "pessoas", alcance: "equipe" }));
    await registrarEvento(acesso, evento(null, "acesso.falhou"));
    await registrarEvento(acesso, evento(B));
    const correnteA = await lerCorrente(dono, A);
    expect(correnteA.map((e) => e.sequencia)).toEqual([1, 2, 3]);
    expect(await verificarCorrente(correnteA)).toEqual({ integra: true, eventos: 3 });
    expect(await verificarCorrente(await lerCorrente(dono, PLATAFORMA))).toEqual({
      integra: true,
      eventos: 1,
    });
    expect(await verificarCorrente(await lerCorrente(dono, B))).toEqual({ integra: true, eventos: 1 });
  });

  it("muitos eventos ao mesmo tempo entram em fila, sem buraco nem repetição", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => registrarEvento(acesso, evento(B, "acesso.entrou", { i }))),
    );
    const correnteB = await lerCorrente(dono, B);
    expect(correnteB.map((e) => e.sequencia)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect((await verificarCorrente(correnteB)).integra).toBe(true);
  });

  it("nunca grava dado sensível nos detalhes", async () => {
    await expect(registrarEvento(acesso, evento(A, "senha.trocou", { senha: "123" }))).rejects.toThrow(
      /sensível/,
    );
    expect((await lerCorrente(dono, A)).length).toBe(3);
  });

  it("ninguém altera nem apaga um evento, nem o dono do banco", async () => {
    await expect(
      dono.query("update auditoria.eventos set acao = 'acesso.saiu' where corrente = $1", [A]),
    ).rejects.toThrow(/não podem ser alterados/);
    await expect(dono.query("delete from auditoria.eventos where corrente = $1", [A])).rejects.toThrow(
      /não podem ser apagados/,
    );
    await expect(dono.query("truncate auditoria.eventos")).rejects.toThrow(/não podem/);
  });

  it("a API e o login não escrevem direto, e não conseguem furar a corrente pelas funções", async () => {
    await expect(app.query("insert into auditoria.eventos (id) values (gen_random_uuid())")).rejects.toThrow(
      /permission denied/,
    );
    await expect(acesso.query("select * from auditoria.correntes")).rejects.toThrow(/permission denied/);
    const falso = {
      id: "00000000-0000-4000-8000-000000000001",
      empresaId: A,
      sequencia: 99,
      ator: { tipo: "sistema", servico: "x" },
      acao: "acesso.entrou",
      origem: { canal: "sistema", ip: null, aparelho: null },
      ocorridoEm: new Date().toISOString(),
      detalhes: {},
      hashAnterior: "a".repeat(64),
      hash: "b".repeat(64),
    };
    await expect(acesso.query("select auditoria.gravar($1::jsonb)", [JSON.stringify(falso)])).rejects.toThrow(
      /não continua a corrente/,
    );
  });

  it("cada empresa lê só os próprios eventos; a corrente da plataforma não aparece para ninguém", async () => {
    const daA = await comEmpresa(
      app,
      A,
      async (c) => (await c.query("select acao from auditoria.eventos")).rows,
    );
    expect(daA).toHaveLength(3);
    const semEmpresa = await app.query("select count(*)::int as n from auditoria.eventos");
    expect(semEmpresa.rows[0].n).toBe(0);
  });

  it("mesmo desligando a proteção à força, a alteração é percebida pela verificação", async () => {
    await dono.query("alter table auditoria.eventos disable trigger eventos_so_acrescenta");
    await dono.query(
      'update auditoria.eventos set detalhes = \'{"metodo":"senha"}\' where corrente = $1 and sequencia = 1',
      [A],
    );
    await dono.query("alter table auditoria.eventos enable trigger eventos_so_acrescenta");
    expect(await verificarCorrente(await lerCorrente(dono, A))).toEqual({
      integra: false,
      sequencia: 1,
      motivo: "o conteúdo foi alterado",
    });
  });

  it("só marcar a cópia externa é permitido, e uma vez só", async () => {
    await dono.query("update auditoria.eventos set copiado_em = now() where corrente = $1", [B]);
    await expect(
      dono.query("update auditoria.eventos set copiado_em = now() where corrente = $1", [B]),
    ).rejects.toThrow(/não podem ser alterados/);
  });

  it("verificação: a cópia confere com o banco; quem reescrever a corrente inteira é pego pela cópia", async () => {
    const empresa = "00000000-0000-7000-8000-0000000000cc";
    await dono.query("insert into empresas (id, nome) values ($1, 'Empresa C')", [empresa]);
    for (let i = 0; i < 3; i++) await registrarEvento(acesso, evento(empresa, "acesso.entrou", { i }));
    const copia = (await exportarPendentes(dono)).filter((e) => e.empresaId === empresa);
    expect(copia).toHaveLength(3);

    const antes = await verificarAuditoria(dono, copia);
    expect(antes.correntes.find((c) => c.corrente === empresa)?.integra).toBe(true);
    expect(antes.copia?.divergentes).toEqual([]);

    // Alguém com acesso total reescreve a corrente C no banco, recalculando as impressões digitais: a corrente
    // continua "fechando", mas não bate mais com a cópia travada.
    const eventos = await lerCorrente(dono, empresa);
    await dono.query("alter table auditoria.eventos disable trigger eventos_so_acrescenta");
    let anterior: string | null = null;
    for (const e of eventos) {
      const { hash: _h, ...resto } = { ...e, detalhes: { i: 99 }, hashAnterior: anterior };
      const { calcularHash } = await import("@mago-os/contratos");
      const novo = await calcularHash(resto);
      await dono.query(
        "update auditoria.eventos set detalhes = $1, hash_anterior = $2, hash = $3 where id = $4",
        [JSON.stringify({ i: 99 }), anterior, novo, e.id],
      );
      anterior = novo;
    }
    await dono.query("alter table auditoria.eventos enable trigger eventos_so_acrescenta");
    const depois = await verificarAuditoria(dono, copia);
    expect(depois.correntes.find((c) => c.corrente === empresa)?.integra).toBe(true);
    expect(depois.copia?.divergentes.map((d) => d.motivo)).toEqual(
      Array(3).fill("diferente da cópia travada"),
    );
    expect(depois.ok).toBe(false);
  });
});
