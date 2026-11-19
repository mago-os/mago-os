/**
 * Listas e status do projeto (M3-02). Cada função roda dentro da transação do chamador (comPessoa), então o banco
 * já isola a empresa. Quem pode mexer (o diretor ou quem edita todos os projetos) é conferido nas rotas.
 *
 * O banco mantém a lista e o status do projeto de cada tarefa (gatilho acertar_tarefa, migração 0018): aqui basta
 * mudar o que a pessoa pediu, e as tarefas acompanham.
 */
import {
  type Lista,
  NOME_DA_LISTA_PADRAO,
  type PedidoDeStatusDoProjeto,
  STATUS_PADRAO_DO_PROJETO,
  type StatusDoProjeto,
  type StatusTarefa,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

/** Todo projeto nasce com a lista "Geral" e os cinco status padrão. */
export async function criarListaEStatusPadrao(c: pg.PoolClient, projetoId: string): Promise<void> {
  await c.query("insert into listas (empresa_id, projeto_id, nome) values (empresa_ativa(), $1, $2)", [
    projetoId,
    NOME_DA_LISTA_PADRAO,
  ]);
  await c.query(
    `insert into status_de_projeto (empresa_id, projeto_id, nome, cor, tipo, ordem)
     select empresa_ativa(), $1, s.nome, s.cor, s.tipo, s.ordem
       from json_to_recordset($2::json) as s(nome text, cor text, tipo text, ordem int)`,
    [projetoId, JSON.stringify(STATUS_PADRAO_DO_PROJETO.map((s, ordem) => ({ ...s, ordem })))],
  );
}

interface LinhaDaLista {
  id: string;
  empresa_id: string;
  projeto_id: string;
  nome: string;
  ordem: number;
  criada_em: Date;
  atualizada_em: Date;
}

const paraLista = (l: LinhaDaLista): Lista => ({
  id: l.id,
  empresaId: l.empresa_id,
  projetoId: l.projeto_id,
  nome: l.nome,
  ordem: l.ordem,
  criadaEm: l.criada_em.toISOString(),
  atualizadaEm: l.atualizada_em.toISOString(),
});

const COLUNAS_DA_LISTA = "l.id, l.empresa_id, l.projeto_id, l.nome, l.ordem, l.criada_em, l.atualizada_em";

export async function listarListas(c: pg.PoolClient, projetoId: string): Promise<Lista[]> {
  const r = await c.query<LinhaDaLista>(
    `select ${COLUNAS_DA_LISTA} from listas l where l.projeto_id = $1 and l.empresa_id = empresa_ativa()
      order by l.ordem, l.id`,
    [projetoId],
  );
  return r.rows.map(paraLista);
}

export async function buscarLista(c: pg.PoolClient, id: string, paraMudar = false): Promise<Lista | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDaLista>(
    `select ${COLUNAS_DA_LISTA} from listas l where l.id = $1 and l.empresa_id = empresa_ativa()
      ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraLista(r.rows[0]) : null;
}

/** Cria a lista no fim do projeto. */
export async function criarLista(c: pg.PoolClient, projetoId: string, nome: string): Promise<Lista> {
  const r = await c.query<LinhaDaLista>(
    `insert into listas as l (empresa_id, projeto_id, nome, ordem)
     values (empresa_ativa(), $1, $2,
             (select coalesce(max(ordem) + 1, 0) from listas where projeto_id = $1 and empresa_id = empresa_ativa()))
     returning ${COLUNAS_DA_LISTA}`,
    [projetoId, nome.trim()],
  );
  return paraLista(r.rows[0] as LinhaDaLista);
}

export async function editarLista(c: pg.PoolClient, lista: Lista): Promise<Lista> {
  const r = await c.query<LinhaDaLista>(
    `update listas l set nome = $2, ordem = $3, atualizada_em = now()
      where l.id = $1 and l.empresa_id = empresa_ativa() returning ${COLUNAS_DA_LISTA}`,
    [lista.id, lista.nome.trim(), lista.ordem],
  );
  return paraLista(r.rows[0] as LinhaDaLista);
}

/**
 * Exclui a lista e passa as tarefas dela para a primeira outra lista do projeto. A última lista não se exclui
 * (tarefa de projeto sempre tem lista). Devolve para onde as tarefas foram, ou nulo se era a última.
 */
export async function excluirLista(
  c: pg.PoolClient,
  lista: Lista,
): Promise<{ para: string; tarefas: number } | null> {
  const outra = await c.query<{ id: string }>(
    `select id from listas where projeto_id = $1 and id <> $2 and empresa_id = empresa_ativa()
      order by ordem, id limit 1`,
    [lista.projetoId, lista.id],
  );
  const para = outra.rows[0]?.id;
  if (!para) return null;
  // Só as tarefas sem mãe: as subtarefas vão junto com elas (gatilho levar_subtarefas).
  const m = await c.query(
    `update tarefas set lista_id = $2, atualizada_em = now()
      where lista_id = $1 and empresa_id = empresa_ativa() and tarefa_mae_id is null`,
    [lista.id, para],
  );
  await c.query("delete from listas where id = $1 and empresa_id = empresa_ativa()", [lista.id]);
  return { para, tarefas: m.rowCount ?? 0 };
}

interface LinhaDoStatus {
  id: string;
  empresa_id: string;
  projeto_id: string;
  nome: string;
  cor: string;
  tipo: StatusTarefa;
  ordem: number;
}

const paraStatus = (l: LinhaDoStatus): StatusDoProjeto => ({
  id: l.id,
  empresaId: l.empresa_id,
  projetoId: l.projeto_id,
  nome: l.nome,
  cor: l.cor,
  tipo: l.tipo,
  ordem: l.ordem,
});

export async function listarStatus(c: pg.PoolClient, projetoId: string): Promise<StatusDoProjeto[]> {
  const r = await c.query<LinhaDoStatus>(
    `select id, empresa_id, projeto_id, nome, cor, tipo, ordem from status_de_projeto
      where projeto_id = $1 and empresa_id = empresa_ativa() order by ordem, id`,
    [projetoId],
  );
  return r.rows.map(paraStatus);
}

/**
 * Grava os status do projeto como vieram (a ordem é a da lista): mantém e renomeia os que têm id, cria os sem id
 * e apaga os que ficaram de fora, passando as tarefas deles para o primeiro status do mesmo tipo que fica.
 * Devolve o motivo da recusa (status de outro projeto, ou tipo trocado), ou nulo.
 */
export async function salvarStatus(
  c: pg.PoolClient,
  projetoId: string,
  pedido: PedidoDeStatusDoProjeto,
): Promise<string | null> {
  const atuais = await listarStatus(c, projetoId);
  const porId = new Map(atuais.map((s) => [s.id, s]));
  for (const s of pedido.status) {
    if (!s.id) continue;
    const atual = porId.get(s.id);
    if (!atual) return "Um dos status não é deste projeto.";
    if (atual.tipo !== s.tipo) return "O tipo de um status não muda depois de criado. Crie um status novo.";
  }
  // Ordem e nomes novos: primeiro tira os nomes do caminho (o nome é único no projeto), depois grava.
  await c.query(
    "update status_de_projeto set nome = id::text where projeto_id = $1 and empresa_id = empresa_ativa()",
    [projetoId],
  );
  const ficam: string[] = [];
  for (const [ordem, s] of pedido.status.entries()) {
    if (s.id) {
      await c.query(
        "update status_de_projeto set nome = $2, cor = $3, ordem = $4 where id = $1 and empresa_id = empresa_ativa()",
        [s.id, s.nome.trim(), s.cor, ordem],
      );
      ficam.push(s.id);
    } else {
      const r = await c.query<{ id: string }>(
        `insert into status_de_projeto (empresa_id, projeto_id, nome, cor, tipo, ordem)
         values (empresa_ativa(), $1, $2, $3, $4, $5) returning id`,
        [projetoId, s.nome.trim(), s.cor, s.tipo, ordem],
      );
      ficam.push((r.rows[0] as { id: string }).id);
    }
  }
  const saem = atuais.filter((s) => !ficam.includes(s.id)).map((s) => s.id);
  if (saem.length > 0) {
    // As tarefas dos que saem vão para o primeiro status do mesmo tipo que fica.
    await c.query(
      `update tarefas t set status_do_projeto_id = (
          select s.id from status_de_projeto s
           where s.projeto_id = t.projeto_id and s.tipo = t.status and s.id <> all($1::uuid[])
           order by s.ordem, s.id limit 1),
         atualizada_em = now()
        where t.status_do_projeto_id = any($1::uuid[]) and t.empresa_id = empresa_ativa()`,
      [saem],
    );
    await c.query(
      "delete from status_de_projeto where id = any($1::uuid[]) and empresa_id = empresa_ativa()",
      [saem],
    );
  }
  return null;
}
