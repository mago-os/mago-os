/**
 * Fila de trabalhos em segundo plano (pg-boss). Fica no próprio PostgreSQL, no esquema "pgboss",
 * então não precisa de outro serviço. Os primeiros trabalhos chegam com as tarefas e rotinas (M2 e M5).
 */
import { PgBoss } from "pg-boss";

export function criarFila(bancoUrl: string): PgBoss {
  const fila = new PgBoss({ connectionString: bancoUrl, application_name: "mago-os-fila" });
  return fila;
}
