/**
 * Empresa ativa: todo acesso a dados de negócio passa por aqui.
 *
 * Abre uma transação, informa ao banco qual é a empresa do pedido e só então roda o trabalho.
 * O Row Level Security do banco garante que nada de outra empresa aparece, mesmo que o código erre o filtro.
 */
import type pg from "pg";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function comEmpresa<T>(
  pool: pg.Pool,
  empresaId: string,
  trabalho: (conexao: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!FORMATO_UUID.test(empresaId)) {
    throw new Error("Empresa inválida: o identificador precisa ser um UUID");
  }
  const conexao = await pool.connect();
  try {
    await conexao.query("begin");
    // O "true" faz a empresa valer só até o fim desta transação: a conexão volta limpa para o pool.
    await conexao.query("select set_config('mago.empresa_id', $1, true)", [empresaId]);
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
