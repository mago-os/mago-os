/**
 * Texto de outros (M4-04, decisão 0026, item 4): a execução que lê texto escrito por outra pessoa (que não quem pediu)
 * ou por um agente externo fica marcada, e daí em diante o que muda dados pede aprovação. Texto dos agentes internos da
 * empresa não marca (o que eles escreveram depois de ler texto de outros já passou por aprovação). Texto do sistema
 * (sem autor, como a cópia de uma tarefa recorrente) marca, porque veio de alguém.
 */
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

/** Condição SQL: o autor (colunas de pessoa e de agente) não é quem pediu ($1) nem um agente interno da empresa. */
function deOutros(pessoa: string, agente: string): string {
  return `((${agente} is null and ${pessoa} is distinct from $1::uuid)
     or (${agente} is not null and not exists (select 1 from agentes g
          where g.id = ${agente} and g.empresa_id = empresa_ativa() and g.tipo = 'interno')))`;
}

export interface FontesDeTexto {
  /** Tarefas cujo título e descrição a ferramenta mostrou. */
  tarefas?: string[];
  /** Tarefas mostradas por inteiro: título, descrição, comentários, checklist, anexos e subtarefas. */
  tarefasInteiras?: string[];
  /** Comentários mostrados (a busca mostra trechos). */
  comentarios?: string[];
  /**
   * Contatos mostrados com as observações (M7-01). Conta como de outros a observação de um contato cadastrado por
   * outra pessoa ou por agente externo, e também a de um contato mudado depois de cadastrado (não se guarda quem
   * escreveu cada mudança, então vale a dúvida).
   */
  contatos?: string[];
  /** Texto escrito por gente de fora da empresa (as mensagens dos contatos, M8-01): marca sempre. */
  textoDeFora?: boolean;
}

/** Se alguma das fontes tem texto de outra pessoa ou de agente externo. */
export async function haTextoDeOutros(
  c: pg.PoolClient,
  pedidoPor: string,
  f: FontesDeTexto,
): Promise<boolean> {
  if (f.textoDeFora) return true;
  const ids = (xs: string[] | undefined) => [...new Set((xs ?? []).filter((x) => FORMATO_UUID.test(x)))];
  const tarefas = ids([...(f.tarefas ?? []), ...(f.tarefasInteiras ?? [])]);
  const inteiras = ids(f.tarefasInteiras);
  const comentarios = ids(f.comentarios);
  const contatos = ids(f.contatos);
  if (tarefas.length + comentarios.length + contatos.length === 0) return false;
  const r = await c.query<{ ha: boolean }>(
    `select exists (
       select 1 from tarefas t where t.empresa_id = empresa_ativa() and t.id = any($2::uuid[])
          and ${deOutros("t.criada_por_pessoa_id", "t.criada_por_agente_id")}
       union all
       select 1 from tarefas s where s.empresa_id = empresa_ativa() and s.tarefa_mae_id = any($3::uuid[])
          and ${deOutros("s.criada_por_pessoa_id", "s.criada_por_agente_id")}
       union all
       select 1 from comentarios_de_tarefa k where k.empresa_id = empresa_ativa() and k.tipo = 'comentario'
          and k.apagado_em is null and (k.tarefa_id = any($3::uuid[]) or k.id = any($4::uuid[]))
          and ${deOutros("k.autor_pessoa_id", "k.autor_agente_id")}
       union all
       select 1 from itens_de_checklist i where i.empresa_id = empresa_ativa() and i.tarefa_id = any($3::uuid[])
          and ${deOutros("i.escrito_por_pessoa_id", "i.escrito_por_agente_id")}
       union all
       select 1 from anexos a where a.empresa_id = empresa_ativa() and a.tarefa_id = any($3::uuid[])
          and (${deOutros("a.enviado_por_pessoa_id", "a.enviado_por_agente_id")}
               or (a.descricao is not null and a.descrito_por_pessoa_id is not null
                   and a.descrito_por_pessoa_id <> $1::uuid))
       union all
       select 1 from contatos ct where ct.empresa_id = empresa_ativa() and ct.id = any($5::uuid[])
          and ct.observacoes is not null
          and (ct.atualizado_em > ct.criado_em or ${deOutros("ct.criado_por", "ct.criado_por_agente_id")})
     ) as ha`,
    [pedidoPor, tarefas, inteiras, comentarios, contatos],
  );
  return r.rows[0]?.ha ?? false;
}

/** Ids de tarefa num resultado (as listas mostram título): procura tarefaId e listas de tarefas com id. */
export function tarefasNoResultado(conteudo: unknown): string[] {
  const ids: string[] = [];
  const visitar = (v: unknown, profundidade: number) => {
    if (profundidade > 4 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 500)) visitar(x, profundidade + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.tarefaId === "string") ids.push(o.tarefaId);
    // Uma tarefa (tem título e status): o id é dela.
    if (typeof o.id === "string" && typeof o.titulo === "string" && "status" in o) ids.push(o.id);
    for (const x of Object.values(o)) visitar(x, profundidade + 1);
  };
  visitar(conteudo, 0);
  return ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

/** Marca a execução (a marca não volta atrás). */
export async function marcarTextoDeOutros(c: pg.PoolClient, execucaoId: string): Promise<void> {
  await c.query(
    "update execucoes_de_agente set leu_texto_de_outros = true where id = $1 and empresa_id = empresa_ativa()",
    [execucaoId],
  );
}
