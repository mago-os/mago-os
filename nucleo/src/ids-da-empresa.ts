/**
 * Ids que um pedido cita e que não são da empresa ativa (M6-01). O teste de vazamento mostrou que uma visão salva e
 * um pedido de aprovação guardavam ids de outra empresa (vindos do próprio pedido, sem mostrar nada dela). Nada vaza
 * por isso, mas uma linha de uma empresa não pode apontar para outra: o que é citado tem que existir na empresa.
 *
 * Roda com a empresa ativa (comEmpresa ou comPessoa). Além do isolamento do banco, cada consulta filtra a empresa.
 */
import type pg from "pg";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Todos os ids (UUID) que aparecem num valor, em qualquer nível. */
export function uuidsDe(valor: unknown): string[] {
  return [...new Set((JSON.stringify(valor ?? null).match(UUID) ?? []).map((x) => x.toLowerCase()))];
}

/**
 * Dos ids, os que não são de nada da empresa ativa: tarefas, projetos, espaços, listas, etiquetas, agentes, pessoas
 * com vínculo, rotinas, eventos, arquivos do Telegram, anexos, itens de checklist, comentários e skills.
 */
export async function idsForaDaEmpresa(c: pg.PoolClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const r = await c.query<{ id: string }>(
    `select u::text as id from unnest($1::uuid[]) u
      where not exists (select 1 from tarefas where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from projetos where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from espacos where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from listas where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from etiquetas where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from agentes where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from vinculos where pessoa_id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from rotinas where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from eventos where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from arquivos_do_telegram where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from anexos where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from itens_de_checklist where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from comentarios_de_tarefa where id = u and empresa_id = empresa_ativa())
        and not exists (select 1 from skills where id = u and empresa_id = empresa_ativa())`,
    [ids],
  );
  return r.rows.map((l) => l.id);
}
