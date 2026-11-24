/**
 * O que é "dado da outra empresa" no teste de vazamento (M6-01): os ids de todas as linhas dela (e das pessoas que
 * só estão nela) e a marca que vai em todo texto que ela escreve. Uma resposta, uma mensagem do Telegram, um aviso
 * do tempo real ou um e-mail que mostre uma dessas coisas a quem é da outra empresa é vazamento.
 */
import type pg from "pg";

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Tabelas com empresa_id (esquemas public e auditoria) e as colunas uuid e jsonb de cada uma. O esquema acesso fica de
 * fora: são as sessões e os convites da pessoa, que mudam a cada login e não guardam dado da empresa.
 */
export async function tabelasDasEmpresas(
  dono: pg.Client,
): Promise<{ tabela: string; uuids: string[]; jsons: string[]; temId: boolean }[]> {
  const r = await dono.query<{ tabela: string; coluna: string; tipo: string }>(
    `select c.table_schema || '.' || c.table_name as tabela, c.column_name as coluna, c.data_type as tipo
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema in ('public', 'auditoria') and t.table_type = 'BASE TABLE'
        and (c.table_schema, c.table_name) in (select table_schema, table_name from information_schema.columns
                              where column_name = 'empresa_id')
      order by 1, 2`,
  );
  const mapa = new Map<string, { tabela: string; uuids: string[]; jsons: string[]; temId: boolean }>();
  for (const l of r.rows) {
    const t = mapa.get(l.tabela) ?? { tabela: l.tabela, uuids: [], jsons: [], temId: false };
    if (l.tipo === "uuid" && l.coluna !== "empresa_id") t.uuids.push(l.coluna);
    if (l.tipo === "jsonb" || l.tipo === "json") t.jsons.push(l.coluna);
    if (l.coluna === "id") t.temId = true;
    mapa.set(l.tabela, t);
  }
  return [...mapa.values()];
}

/** Todos os ids que aparecem nas linhas de uma empresa (colunas uuid e dentro dos jsonb) e o dono de cada id. */
export async function idsDasEmpresas(dono: pg.Client): Promise<Map<string, string>> {
  const donoDoId = new Map<string, string>();
  const tabelas = await tabelasDasEmpresas(dono);
  for (const t of tabelas) {
    if (!t.temId) continue;
    const r = await dono.query<{ id: string; empresa_id: string }>(
      `select id::text, empresa_id::text from ${t.tabela}`,
    );
    for (const l of r.rows) donoDoId.set(l.id, l.empresa_id);
  }
  // As pessoas de uma empresa só (as de mais de uma não são "da outra").
  const p = await dono.query<{ pessoa_id: string; empresa_id: string }>(
    `select pessoa_id::text, min(empresa_id::text) as empresa_id from vinculos
      group by pessoa_id having count(distinct empresa_id) = 1`,
  );
  for (const l of p.rows) donoDoId.set(l.pessoa_id, l.empresa_id);
  const e = await dono.query<{ id: string }>("select id::text from empresas");
  for (const l of e.rows) donoDoId.set(l.id, l.id);
  return donoDoId;
}

/** Retrato das linhas de uma empresa: muda se qualquer linha dela mudar, entrar ou sair. */
export async function retratoDaEmpresa(dono: pg.Client, empresaId: string): Promise<Record<string, string>> {
  const retrato: Record<string, string> = {};
  for (const t of await tabelasDasEmpresas(dono)) {
    const r = await dono.query<{ h: string | null; n: string }>(
      `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::text as n
         from ${t.tabela} x where empresa_id = $1`,
      [empresaId],
    );
    retrato[t.tabela] = `${r.rows[0]?.n}:${r.rows[0]?.h}`;
  }
  const p = await dono.query<{ h: string }>(
    `select md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as h
       from pessoas p join vinculos v on v.pessoa_id = p.id where v.empresa_id = $1`,
    [empresaId],
  );
  retrato.pessoas = p.rows[0]?.h ?? "";
  return retrato;
}

/**
 * Referências cruzadas: uma linha de uma empresa que aponta (numa coluna uuid ou dentro de um jsonb) para um id de
 * outra empresa. Devolve uma descrição de cada uma.
 */
/**
 * Colunas que guardam o que foi pedido, como veio (não é uma referência que o sistema segue): a entrada que o modelo
 * escreveu em cada passo do agente fica registrada mesmo quando a ferramenta recusa um id de outra empresa.
 */
const REGISTROS_DO_QUE_FOI_PEDIDO = new Set(["public.passos_de_execucao.entrada"]);

export async function referenciasCruzadas(dono: pg.Client): Promise<string[]> {
  const donoDoId = await idsDasEmpresas(dono);
  const problemas: string[] = [];
  for (const t of await tabelasDasEmpresas(dono)) {
    const colunas = [...t.uuids, ...t.jsons].filter(
      (c) => !REGISTROS_DO_QUE_FOI_PEDIDO.has(`${t.tabela}.${c}`),
    );
    if (colunas.length === 0) continue;
    const r = await dono.query<Record<string, string | null>>(
      `select empresa_id::text as empresa_id, ${colunas.map((c) => `${c}::text as "${c}"`).join(", ")}
         from ${t.tabela}`,
    );
    for (const l of r.rows) {
      for (const c of colunas) {
        for (const id of (l[c] ?? "").match(UUID) ?? []) {
          const deQuem = donoDoId.get(id.toLowerCase());
          if (deQuem && deQuem !== l.empresa_id)
            problemas.push(`${t.tabela}.${c} aponta para ${id} (outra empresa)`);
        }
      }
    }
  }
  return problemas;
}

/** O que, num texto, é da empresa "de": os ids dela e a marca. */
export function vazamentosNoTexto(texto: string, idsDaOutra: Set<string>, marcaDaOutra: string): string[] {
  const achados: string[] = [];
  if (texto.includes(marcaDaOutra)) achados.push(`marca ${marcaDaOutra}`);
  for (const id of texto.match(UUID) ?? []) if (idsDaOutra.has(id.toLowerCase())) achados.push(`id ${id}`);
  return [...new Set(achados)];
}
