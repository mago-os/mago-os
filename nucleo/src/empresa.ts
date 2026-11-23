/**
 * Empresa ativa e pessoa do pedido: todo acesso a dados de negócio passa por aqui.
 *
 * Abre uma transação, informa ao banco quem está pedindo e em qual empresa, e só então roda o trabalho.
 * O Row Level Security do banco garante que nada de outra empresa aparece, mesmo que o código erre o filtro.
 * Com uma pessoa informada, o banco ainda confere se ela tem vínculo ativo na empresa (migração 0002):
 * sem vínculo, nenhum dado da empresa aparece.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/**
 * Trabalho feito por uma rotina (M5-06, decisão 0040): a rotina rodando e o agente que ela chamou. Dentro dele, toda
 * transação avisa o banco (mago.da_rotina), e os eventos que ela causar não disparam outra rotina.
 */
export const trabalhoDeRotina = new AsyncLocalStorage<true>();

/** Roda o trabalho como da rotina. */
export function comoRotina<T>(trabalho: () => Promise<T>): Promise<T> {
  return trabalhoDeRotina.run(true, trabalho);
}

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function conferirUuid(valor: string, oQue: string): void {
  if (!FORMATO_UUID.test(valor)) {
    throw new Error(`${oQue} inválida: o identificador precisa ser um UUID`);
  }
}

async function comContexto<T>(
  pool: pg.Pool,
  contexto: { empresaId: string | null; pessoaId: string | null },
  trabalho: (conexao: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (contexto.empresaId !== null) conferirUuid(contexto.empresaId, "Empresa");
  if (contexto.pessoaId !== null) conferirUuid(contexto.pessoaId, "Pessoa");
  const conexao = await pool.connect();
  try {
    await conexao.query("begin");
    // O "true" faz cada informação valer só até o fim desta transação: a conexão volta limpa para o pool.
    await conexao.query(
      "select set_config('mago.empresa_id', $1, true), set_config('mago.pessoa_id', $2, true)",
      [contexto.empresaId ?? "", contexto.pessoaId ?? ""],
    );
    if (trabalhoDeRotina.getStore()) await conexao.query("select set_config('mago.da_rotina', '1', true)");
    const resultado = await trabalho(conexao);
    await conexao.query("commit");
    return resultado;
  } catch (erro) {
    await conexao.query("rollback").catch(() => {});
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Trabalho do próprio sistema (fila, rotinas) dentro de uma empresa, sem pessoa no pedido. */
export function comEmpresa<T>(
  pool: pg.Pool,
  empresaId: string,
  trabalho: (conexao: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return comContexto(pool, { empresaId, pessoaId: null }, trabalho);
}

/**
 * Pedido de uma pessoa. empresaId é a empresa ativa da sessão, ou nulo antes de ela escolher
 * (aí ela vê só a si mesma, os próprios vínculos e as próprias empresas).
 */
export function comPessoa<T>(
  pool: pg.Pool,
  pessoaId: string,
  empresaId: string | null,
  trabalho: (conexao: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return comContexto(pool, { empresaId, pessoaId }, trabalho);
}
