/**
 * Conexão com o PostgreSQL. Um "pool" de conexões por processo; nenhum dado fica guardado na memória da API.
 */
import pg from "pg";

/** O mínimo que a API precisa do banco. Os testes de unidade usam uma versão falsa disto. */
export interface Banco {
  /** Responde se o banco está acessível agora. Nunca lança erro. */
  estaSaudavel(): Promise<boolean>;
  fechar(): Promise<void>;
}

export function criarBanco(url: string): Banco & { pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    application_name: "mago-os-nucleo",
  });
  // Sem isto, uma conexão que cai enquanto parada derruba o processo inteiro.
  pool.on("error", () => {});

  return {
    pool,
    async estaSaudavel() {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    async fechar() {
      await pool.end();
    },
  };
}
