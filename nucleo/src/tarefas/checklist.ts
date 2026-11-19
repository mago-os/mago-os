/**
 * Checklist da tarefa (M3-02): itens de texto com marcar e desmarcar, ordem e quem marcou. Cada função roda dentro
 * da transação do chamador, que já conferiu que quem pede alcança a tarefa (e, travada, é quem pegou).
 */
import type { Autor, ItemDeChecklist } from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

interface LinhaDoItem {
  id: string;
  empresa_id: string;
  tarefa_id: string;
  texto: string;
  ordem: number;
  marcado: boolean;
  marcado_por_pessoa_id: string | null;
  marcado_por_agente_id: string | null;
  marcado_em: Date | null;
  criado_em: Date;
}

const COLUNAS = `i.id, i.empresa_id, i.tarefa_id, i.texto, i.ordem, i.marcado, i.marcado_por_pessoa_id,
  i.marcado_por_agente_id, i.marcado_em, i.criado_em`;

function paraItem(l: LinhaDoItem): ItemDeChecklist {
  const marcadoPor: Autor | null = l.marcado_por_pessoa_id
    ? { tipo: "pessoa", pessoaId: l.marcado_por_pessoa_id }
    : l.marcado_por_agente_id
      ? { tipo: "agente", agenteId: l.marcado_por_agente_id }
      : null;
  return {
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId: l.tarefa_id,
    texto: l.texto,
    ordem: l.ordem,
    marcado: l.marcado,
    marcadoPor,
    marcadoEm: l.marcado_em ? l.marcado_em.toISOString() : null,
    criadoEm: l.criado_em.toISOString(),
  };
}

export async function listarChecklist(c: pg.PoolClient, tarefaId: string): Promise<ItemDeChecklist[]> {
  const r = await c.query<LinhaDoItem>(
    `select ${COLUNAS} from itens_de_checklist i where i.tarefa_id = $1 and i.empresa_id = empresa_ativa()
      order by i.ordem, i.criado_em, i.id`,
    [tarefaId],
  );
  return r.rows.map(paraItem);
}

export async function buscarItem(
  c: pg.PoolClient,
  tarefaId: string,
  itemId: string,
): Promise<ItemDeChecklist | null> {
  if (!FORMATO_UUID.test(itemId)) return null;
  const r = await c.query<LinhaDoItem>(
    `select ${COLUNAS} from itens_de_checklist i
      where i.id = $1 and i.tarefa_id = $2 and i.empresa_id = empresa_ativa() for update`,
    [itemId, tarefaId],
  );
  return r.rows[0] ? paraItem(r.rows[0]) : null;
}

/** Acrescenta o item no fim do checklist e marca a tarefa como atualizada. */
export async function criarItem(c: pg.PoolClient, tarefaId: string, texto: string): Promise<ItemDeChecklist> {
  const r = await c.query<LinhaDoItem>(
    `insert into itens_de_checklist as i (empresa_id, tarefa_id, texto, ordem)
     values (empresa_ativa(), $1, $2,
             (select coalesce(max(ordem) + 1, 0) from itens_de_checklist
               where tarefa_id = $1 and empresa_id = empresa_ativa()))
     returning ${COLUNAS}`,
    [tarefaId, texto.trim()],
  );
  await tocarTarefa(c, tarefaId);
  return paraItem(r.rows[0] as LinhaDoItem);
}

/** Muda texto, posição ou marca e desmarca. Quem marca fica guardado; desmarcar apaga quem e quando. */
export async function editarItem(
  c: pg.PoolClient,
  item: ItemDeChecklist,
  mudanca: { texto?: string; ordem?: number; marcado?: boolean },
  autor: Autor,
): Promise<ItemDeChecklist> {
  const marcado = mudanca.marcado ?? item.marcado;
  const passouAMarcar = marcado && !item.marcado;
  const pessoa = autor.tipo === "pessoa" ? autor.pessoaId : null;
  const agente = autor.tipo === "agente" ? autor.agenteId : null;
  const r = await c.query<LinhaDoItem>(
    `update itens_de_checklist i set texto = $2, ordem = $3, marcado = $4,
        marcado_por_pessoa_id = case when not $4 then null when $5 then $6::uuid else i.marcado_por_pessoa_id end,
        marcado_por_agente_id = case when not $4 then null when $5 then $7::uuid else i.marcado_por_agente_id end,
        marcado_em = case when not $4 then null when $5 then now() else i.marcado_em end
      where i.id = $1 and i.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      item.id,
      (mudanca.texto ?? item.texto).trim(),
      mudanca.ordem ?? item.ordem,
      marcado,
      passouAMarcar,
      pessoa,
      agente,
    ],
  );
  await tocarTarefa(c, item.tarefaId);
  return paraItem(r.rows[0] as LinhaDoItem);
}

export async function excluirItem(c: pg.PoolClient, item: ItemDeChecklist): Promise<void> {
  await c.query("delete from itens_de_checklist where id = $1 and empresa_id = empresa_ativa()", [item.id]);
  await tocarTarefa(c, item.tarefaId);
}

async function tocarTarefa(c: pg.PoolClient, tarefaId: string): Promise<void> {
  await c.query("update tarefas set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    tarefaId,
  ]);
}
