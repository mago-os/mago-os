/**
 * Trava contra tentativas (M1-03): 5 senhas erradas seguidas travam o e-mail por 15 minutos.
 * Vale também para e-mails sem conta, para a trava não revelar quais e-mails existem.
 */
import type pg from "pg";

export const FALHAS_ATE_TRAVAR = 5;
export const MINUTOS_TRAVADO = 15;

/** Se o e-mail está travado, devolve até quando; senão, nulo. */
export async function travadoAte(pool: pg.Pool, email: string): Promise<Date | null> {
  const r = await pool.query<{ travada_ate: Date | null }>(
    "select travada_ate from acesso.travas where email = $1 and travada_ate > now()",
    [email],
  );
  return r.rows[0]?.travada_ate ?? null;
}

/** Conta uma senha errada. Na quinta seguida, trava e zera a contagem. Devolve se travou agora. */
export async function registrarFalha(pool: pg.Pool, email: string): Promise<boolean> {
  const r = await pool.query<{ travou: boolean }>(
    `insert into acesso.travas as t (email, falhas, ultima_falha) values ($1, 1, now())
       on conflict (email) do update set falhas = t.falhas + 1, ultima_falha = now()
     returning falhas >= $2 as travou`,
    [email, FALHAS_ATE_TRAVAR],
  );
  const travou = r.rows[0]?.travou === true;
  if (travou) {
    await pool.query(
      `update acesso.travas set falhas = 0, travada_ate = now() + make_interval(mins => $2) where email = $1`,
      [email, MINUTOS_TRAVADO],
    );
  }
  return travou;
}

/** Senha certa: apaga a contagem. */
export async function registrarAcerto(pool: pg.Pool, email: string): Promise<void> {
  await pool.query("delete from acesso.travas where email = $1", [email]);
}
