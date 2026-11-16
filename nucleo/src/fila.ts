/**
 * Fila de trabalhos em segundo plano (pg-boss). Fica no próprio PostgreSQL, no esquema "pgboss",
 * então não precisa de outro serviço. O esquema é criado pela migração 0001, já com o papel da API
 * (mago_app) como dono; por isso a fila não tenta criá-lo (createSchema: false). Os primeiros trabalhos chegam com as tarefas e rotinas (M2 e M5).
 */
import { PgBoss } from "pg-boss";

export function criarFila(bancoUrl: string): PgBoss {
  const fila = new PgBoss({
    connectionString: bancoUrl,
    application_name: "mago-os-fila",
    createSchema: false,
  });
  return fila;
}
