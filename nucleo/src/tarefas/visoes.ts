/**
 * Visões salvas (M3-04): pessoais. O próprio banco só mostra a cada pessoa as visões dela (política com
 * pessoa_ativa()), então aqui não há filtro de dona além do que o banco já faz.
 */
import type {
  Agrupamento,
  FiltroDeTarefas,
  PedidoDeVisaoSalva,
  TipoDeVisao,
  VisaoSalva,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

interface LinhaDaVisao {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  nome: string;
  tipo: TipoDeVisao;
  filtro: FiltroDeTarefas;
  agrupar_por: Agrupamento | null;
  criada_em: Date;
}

const paraVisao = (l: LinhaDaVisao): VisaoSalva => ({
  id: l.id,
  empresaId: l.empresa_id,
  pessoaId: l.pessoa_id,
  nome: l.nome,
  tipo: l.tipo,
  filtro: l.filtro,
  agruparPor: l.agrupar_por,
  criadaEm: l.criada_em.toISOString(),
});

const COLUNAS = "id, empresa_id, pessoa_id, nome, tipo, filtro, agrupar_por, criada_em";

export async function listarVisoes(c: pg.PoolClient): Promise<VisaoSalva[]> {
  const r = await c.query<LinhaDaVisao>(
    `select ${COLUNAS} from visoes_salvas where empresa_id = empresa_ativa() order by lower(nome), id`,
  );
  return r.rows.map(paraVisao);
}

export async function salvarVisao(c: pg.PoolClient, pedido: PedidoDeVisaoSalva): Promise<VisaoSalva> {
  const r = await c.query<LinhaDaVisao>(
    `insert into visoes_salvas (empresa_id, pessoa_id, nome, tipo, filtro, agrupar_por)
     values (empresa_ativa(), pessoa_ativa(), $1, $2, $3::jsonb, $4) returning ${COLUNAS}`,
    [
      pedido.nome.trim(),
      pedido.tipo,
      JSON.stringify(pedido.filtro),
      pedido.tipo === "lista" ? (pedido.agruparPor ?? null) : null,
    ],
  );
  return paraVisao(r.rows[0] as LinhaDaVisao);
}

/** Apaga a visão da pessoa. Devolve falso se não é dela (ou não existe). */
export async function excluirVisao(c: pg.PoolClient, id: string): Promise<boolean> {
  if (!FORMATO_UUID.test(id)) return false;
  const r = await c.query("delete from visoes_salvas where id = $1 and empresa_id = empresa_ativa()", [id]);
  return (r.rowCount ?? 0) > 0;
}
