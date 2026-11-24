/**
 * Ids que um pedido cita e que não são da empresa ativa (M6-01). O teste de vazamento mostrou que uma visão salva e
 * um pedido de aprovação guardavam ids de outra empresa (vindos do próprio pedido, sem mostrar nada dela). Nada vaza
 * por isso, mas uma linha de uma empresa não pode apontar para outra: o que é citado tem que existir na empresa.
 *
 * Roda com a empresa ativa (comEmpresa ou comPessoa). Além do isolamento do banco, cada consulta filtra a empresa.
 */
import type pg from "pg";

/** Recusa quando o pedido cita algo que não existe na empresa (sem repetir os ids). */
export const NAO_ENCONTRADO_NA_EMPRESA =
  "Algum item citado (tarefa, projeto, pessoa, agente, rotina ou arquivo) não existe nesta empresa. Confira e tente de novo.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campos que guardam ids (além dos que terminam em Id ou Ids, como tarefaId, pessoaId e agenteIds). */
const CAMPOS_DE_IDS = new Set(["participantes", "etiquetas", "pessoas", "skills"]);
const eCampoDeId = (campo: string) => /Ids?$/.test(campo) || CAMPOS_DE_IDS.has(campo);

/**
 * Os ids que o pedido cita: só os valores dos campos de id, em qualquer nível. Um id escrito num texto livre (um
 * comentário, um título, um resultado) não conta: pode ser de outro sistema.
 */
export function uuidsDe(valor: unknown, campo = ""): string[] {
  const achados = new Set<string>();
  const andar = (v: unknown, c: string) => {
    if (typeof v === "string") {
      if (eCampoDeId(c) && UUID.test(v)) achados.add(v.toLowerCase());
    } else if (Array.isArray(v)) {
      for (const x of v) andar(x, c);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) andar(x, k);
    }
  };
  andar(valor, campo);
  return [...achados];
}

/** As tabelas da empresa com id próprio, lidas do banco uma vez (uma tabela nova entra sozinha). */
let tabelasComId: Promise<string[]> | null = null;
function tabelas(c: pg.PoolClient): Promise<string[]> {
  tabelasComId ??= c
    .query<{ tabela: string }>(
      `select i.table_name as tabela from information_schema.columns i
         join information_schema.columns e on e.table_schema = i.table_schema and e.table_name = i.table_name
          and e.column_name = 'empresa_id'
        where i.table_schema = 'public' and i.column_name = 'id' and i.data_type = 'uuid'
        order by 1`,
    )
    .then((r) => r.rows.map((l) => l.tabela).filter((t) => /^[a-z_]+$/.test(t)))
    .catch((erro: unknown) => {
      tabelasComId = null;
      throw erro;
    });
  return tabelasComId;
}

/** Dos ids, os que não são de nenhuma linha da empresa ativa (nem de uma pessoa com vínculo nela). */
export async function idsForaDaEmpresa(c: pg.PoolClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const existe = (await tabelas(c))
    .map((t) => `select 1 from public.${t} where id = u and empresa_id = empresa_ativa()`)
    .concat("select 1 from public.vinculos where pessoa_id = u and empresa_id = empresa_ativa()")
    .join(" union all ");
  const r = await c.query<{ id: string }>(
    `select u::text as id from unnest($1::uuid[]) u where not exists (${existe})`,
    [ids],
  );
  return r.rows.map((l) => l.id);
}
