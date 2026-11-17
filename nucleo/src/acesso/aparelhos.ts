/**
 * Sessões e aparelhos (M1-08): reconhecer o aparelho, avisar de aparelho novo e expirar por inatividade.
 * Ver docs/decisoes/0013-sessoes-e-aparelhos.md.
 */
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

/** A sessão cai depois de 3 dias sem uso. */
export const DIAS_DE_INATIVIDADE = 3;
/** Mesmo em uso contínuo, pede login de novo depois de 30 dias. */
export const DIAS_NO_MAXIMO = 30;
/** O último uso é gravado no máximo a cada 5 minutos, para não escrever no banco a cada pedido. */
export const MINUTOS_ENTRE_REGISTROS_DE_USO = 5;

/** Cookie com a etiqueta do aparelho: de longa duração, só o servidor lê. */
export const COOKIE_DO_APARELHO = "mago_aparelho";
export const SEGUNDOS_DA_ETIQUETA = 400 * 24 * 60 * 60;

export function novaEtiqueta(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda só a impressão digital da etiqueta. */
export function impressaoDaEtiqueta(etiqueta: string): string {
  return createHash("sha256").update(etiqueta).digest("hex");
}

/** Nome legível do aparelho a partir do navegador (ex.: "Chrome no Mac", "Safari no iPhone"). */
export function nomeDoAparelho(navegador: string | null | undefined): string {
  const ua = navegador ?? "";
  const sistema = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const programa = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  if (programa && sistema) return `${programa} no ${sistema}`;
  return programa ?? sistema ?? "Aparelho desconhecido";
}

/**
 * Registra o aparelho de uma sessão nova. Se a pessoa nunca entrou por ele e já tem outro aparelho, cria o
 * aviso de aparelho novo (o primeiro aparelho de todos não avisa ninguém).
 */
export async function registrarAparelho(
  pool: pg.Pool,
  dados: { pessoaId: string; etiqueta: string; navegador: string | null; ip: string | null },
): Promise<{ aparelhoId: string; novo: boolean }> {
  const nome = nomeDoAparelho(dados.navegador);
  const r = await pool.query<{ id: string; novo: boolean }>(
    `insert into acesso.aparelhos as a (pessoa_id, etiqueta, nome) values ($1, $2, $3)
       on conflict (pessoa_id, etiqueta) do update set ultimo_acesso = now(), nome = excluded.nome
     returning id, (xmax = 0) as novo`,
    [dados.pessoaId, impressaoDaEtiqueta(dados.etiqueta), nome],
  );
  const aparelho = r.rows[0] as { id: string; novo: boolean };
  if (aparelho.novo) {
    await pool.query(
      `insert into acesso.avisos (pessoa_id, tipo, aparelho_id, aparelho_nome, ip)
         select $1, 'aparelho_novo', $2, $3, $4
          where exists (select 1 from acesso.aparelhos where pessoa_id = $1 and id <> $2)`,
      [dados.pessoaId, aparelho.id, nome, dados.ip],
    );
  }
  return { aparelhoId: aparelho.id, novo: aparelho.novo };
}

/**
 * Confere a validade da sessão pelas regras do Mago OS (inatividade e máximo de 30 dias) e grava o último uso.
 * Devolve falso, e apaga a sessão, quando ela não vale mais.
 */
export async function sessaoAindaVale(pool: pg.Pool, sessaoId: string, agora = new Date()): Promise<boolean> {
  const r = await pool.query<{ criada_em: Date; ultimo_uso_em: Date }>(
    "select criada_em, ultimo_uso_em from acesso.sessoes where id = $1",
    [sessaoId],
  );
  const s = r.rows[0];
  if (!s) return false;
  const dia = 24 * 60 * 60 * 1000;
  const vencida =
    agora.getTime() - s.criada_em.getTime() > DIAS_NO_MAXIMO * dia ||
    agora.getTime() - s.ultimo_uso_em.getTime() > DIAS_DE_INATIVIDADE * dia;
  if (vencida) {
    await pool.query("delete from acesso.sessoes where id = $1", [sessaoId]);
    return false;
  }
  if (agora.getTime() - s.ultimo_uso_em.getTime() > MINUTOS_ENTRE_REGISTROS_DE_USO * 60_000) {
    await pool.query("update acesso.sessoes set ultimo_uso_em = $2 where id = $1", [sessaoId, agora]);
  }
  return true;
}
