/**
 * Banco temporário para testes e para gerar a documentação: cria um banco vazio no servidor,
 * roda todas as migrações e, no fim, apaga tudo. Nunca toca no banco "mago" do ambiente local.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrar } from "./migrar.ts";

export interface BancoTemporario {
  nome: string;
  /** Conexão com o papel dono das tabelas (o mesmo das migrações). */
  urlDono: string;
  /** Conexão com o papel da API (mago_app), que obedece o isolamento por empresa. */
  urlApp: string;
  /** Conexão com o papel do login (mago_acesso), que só mexe no esquema acesso e lê as pessoas. */
  urlAcesso: string;
  apagar(): Promise<void>;
}

/** Servidor usado nos testes. Padrão: o banco do ambiente local (pnpm local:subir). */
export function urlDoServidorDeTeste(): string {
  return process.env.MAGO_TESTE_BANCO_URL ?? "postgres://mago@127.0.0.1:54318/postgres";
}

function trocarBanco(url: string, banco: string, usuario?: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  if (usuario) {
    u.username = usuario;
    u.password = "";
  }
  return u.toString();
}

export async function servidorDeTesteAcessivel(url = urlDoServidorDeTeste()): Promise<boolean> {
  const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await cliente.connect();
    return true;
  } catch {
    return false;
  } finally {
    await cliente.end().catch(() => {});
  }
}

export async function criarBancoTemporario(
  opcoes: { migrar?: boolean; urlServidor?: string } = {},
): Promise<BancoTemporario> {
  const urlServidor = opcoes.urlServidor ?? urlDoServidorDeTeste();
  const nome = `mago_teste_${randomBytes(6).toString("hex")}`;
  const urlDono = trocarBanco(urlServidor, nome);
  const admin = new pg.Client({ connectionString: urlServidor });
  await admin.connect();
  try {
    await admin.query(`create database ${nome}`);
    // Os papéis (mago_app, mago_acesso) valem para o servidor inteiro: num servidor novo, dois arquivos de teste
    // migrando ao mesmo tempo tentariam criá-los juntos. Enquanto eles não existem, as migrações vão uma de cada vez.
    const papeis = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_roles where rolname in ('mago_app', 'mago_acesso')",
    );
    const primeiro = (papeis.rows[0]?.n ?? 0) < 2;
    if (opcoes.migrar !== false) {
      if (primeiro) await admin.query("select pg_advisory_lock(hashtext('mago-os-teste-papeis'))");
      try {
        await migrar(urlDono, "up");
      } finally {
        if (primeiro) await admin.query("select pg_advisory_unlock(hashtext('mago-os-teste-papeis'))");
      }
    }
  } finally {
    await admin.end();
  }

  return {
    nome,
    urlDono,
    urlApp: trocarBanco(urlServidor, nome, "mago_app"),
    urlAcesso: trocarBanco(urlServidor, nome, "mago_acesso"),
    async apagar() {
      const fim = new pg.Client({ connectionString: urlServidor });
      await fim.connect();
      try {
        await fim.query(`drop database if exists ${nome} with (force)`);
      } finally {
        await fim.end();
      }
    },
  };
}
