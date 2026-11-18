/**
 * Tarefas (M2-01): o que se faz com uma tarefa, igual para as rotas da tela e, a partir da M2-05, para o MCP.
 *
 * Cada função roda dentro da transação que o chamador abriu (comPessoa ou, para agentes, a da M2-04), então o
 * banco já isola a empresa. Aqui fica o "quem vê o quê": o alcance da verificação central vira a condição SQL.
 * As regras de formato do contrato também estão no banco (migração 0013), como segunda barreira.
 */
import type { Autor, ComentarioDeTarefa, Responsavel, StatusTarefa, Tarefa } from "@mago-os/contratos";
import type pg from "pg";
import type { Filtro } from "../permissoes/calcular.ts";

/** Quem está pedindo: uma pessoa (com o alcance da ação) ou um agente (só as tarefas dele, M2-03). */
export type Quem =
  | { tipo: "pessoa"; pessoaId: string; filtro: Filtro }
  | { tipo: "agente"; agenteId: string };

export function autorDe(quem: Quem): Autor {
  return quem.tipo === "pessoa"
    ? { tipo: "pessoa", pessoaId: quem.pessoaId }
    : { tipo: "agente", agenteId: quem.agenteId };
}

/** Condição SQL (sobre a tabela "t") das tarefas que quem pede alcança. "jaUsados": quantos valores a consulta já tem. */
export function condicaoDeAlcance(quem: Quem, jaUsados: number): { sql: string; valores: string[] } {
  const p = (n: number) => `$${jaUsados + n + 1}`;
  if (quem.tipo === "agente") {
    return {
      sql: `(t.responsavel_agente_id = ${p(0)} or t.travada_por_agente_id = ${p(0)})`,
      valores: [quem.agenteId],
    };
  }
  const meus = `(t.responsavel_pessoa_id = ${p(0)} or t.criada_por_pessoa_id = ${p(0)})`;
  const { filtro } = quem;
  if (filtro.tipo === "tudo") return { sql: "true", valores: [] };
  if (filtro.tipo === "meus") return { sql: meus, valores: [filtro.pessoaId] };
  return {
    sql: `(${meus} or exists (select 1 from vinculos v where v.empresa_id = t.empresa_id and v.area = ${p(1)}
             and v.pessoa_id in (t.responsavel_pessoa_id, t.criada_por_pessoa_id)))`,
    valores: [filtro.pessoaId, filtro.area],
  };
}

const COLUNAS = `t.id, t.empresa_id, t.titulo, t.descricao, t.status,
  t.responsavel_pessoa_id, t.responsavel_agente_id, t.criada_por_pessoa_id, t.criada_por_agente_id,
  t.travada_por_pessoa_id, t.travada_por_agente_id, t.travada_em,
  t.resultado, t.resultado_por_pessoa_id, t.resultado_por_agente_id, t.criada_em, t.atualizada_em, t.encerrada_em`;

interface LinhaDaTarefa {
  id: string;
  empresa_id: string;
  titulo: string;
  descricao: string | null;
  status: StatusTarefa;
  responsavel_pessoa_id: string | null;
  responsavel_agente_id: string | null;
  criada_por_pessoa_id: string | null;
  criada_por_agente_id: string | null;
  travada_por_pessoa_id: string | null;
  travada_por_agente_id: string | null;
  travada_em: Date | null;
  resultado: string | null;
  resultado_por_pessoa_id: string | null;
  resultado_por_agente_id: string | null;
  criada_em: Date;
  atualizada_em: Date;
  encerrada_em: Date | null;
}

function responsavelDe(pessoa: string | null, agente: string | null): Responsavel | null {
  if (pessoa) return { tipo: "pessoa", pessoaId: pessoa };
  if (agente) return { tipo: "agente", agenteId: agente };
  return null;
}

function autorDaLinha(pessoa: string | null, agente: string | null): Autor {
  return responsavelDe(pessoa, agente) ?? { tipo: "sistema" };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function linhaParaTarefa(l: LinhaDaTarefa): Tarefa {
  const travadaPor = responsavelDe(l.travada_por_pessoa_id, l.travada_por_agente_id);
  return {
    id: l.id,
    empresaId: l.empresa_id,
    titulo: l.titulo,
    descricao: l.descricao,
    status: l.status,
    responsavel: responsavelDe(l.responsavel_pessoa_id, l.responsavel_agente_id),
    criadaPor: autorDaLinha(l.criada_por_pessoa_id, l.criada_por_agente_id),
    trava: travadaPor && l.travada_em ? { por: travadaPor, desde: l.travada_em.toISOString() } : null,
    resultado: l.resultado,
    resultadoPor:
      l.resultado === null ? null : autorDaLinha(l.resultado_por_pessoa_id, l.resultado_por_agente_id),
    criadaEm: l.criada_em.toISOString(),
    atualizadaEm: l.atualizada_em.toISOString(),
    encerradaEm: iso(l.encerrada_em),
  };
}

/** Separa um responsável ou autor nas duas colunas do banco (pessoa, agente). */
function colunas(r: Responsavel | Autor | null): [string | null, string | null] {
  if (r?.tipo === "pessoa") return [r.pessoaId, null];
  if (r?.tipo === "agente") return [null, r.agenteId];
  return [null, null];
}

export interface FiltroDaLista {
  /** Só as tarefas em que quem pede é o responsável ou que ele criou. */
  minhas?: boolean;
  status?: StatusTarefa[];
}

/** Lista as tarefas que quem pede alcança, as mais recentes primeiro (até 200 no M2). */
export async function listarTarefas(c: pg.PoolClient, quem: Quem, filtro: FiltroDaLista): Promise<Tarefa[]> {
  const alcance = condicaoDeAlcance(quem, 0);
  const valores: unknown[] = [...alcance.valores];
  const partes = [alcance.sql];
  if (filtro.minhas) {
    const minhas = condicaoDeAlcance(
      quem.tipo === "pessoa"
        ? { tipo: "pessoa", pessoaId: quem.pessoaId, filtro: { tipo: "meus", pessoaId: quem.pessoaId } }
        : quem,
      valores.length,
    );
    partes.push(minhas.sql);
    valores.push(...minhas.valores);
  }
  if (filtro.status && filtro.status.length > 0) {
    valores.push(filtro.status);
    partes.push(`t.status = any($${valores.length}::text[])`);
  }
  const r = await c.query<LinhaDaTarefa>(
    `select ${COLUNAS} from tarefas t where t.empresa_id = empresa_ativa() and ${partes.join(" and ")}
      order by t.atualizada_em desc limit 200`,
    valores,
  );
  return r.rows.map(linhaParaTarefa);
}

/** A tarefa, se quem pede a alcança. "Para mudar" trava a linha até o fim da transação. */
export async function buscarTarefa(
  c: pg.PoolClient,
  quem: Quem,
  id: string,
  paraMudar = false,
): Promise<Tarefa | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const alcance = condicaoDeAlcance(quem, 1);
  const r = await c.query<LinhaDaTarefa>(
    `select ${COLUNAS} from tarefas t where t.id = $1 and t.empresa_id = empresa_ativa() and ${alcance.sql}
      ${paraMudar ? "for update" : ""}`,
    [id, ...alcance.valores],
  );
  const linha = r.rows[0];
  return linha ? linhaParaTarefa(linha) : null;
}

export async function listarComentarios(c: pg.PoolClient, tarefaId: string): Promise<ComentarioDeTarefa[]> {
  const r = await c.query<{
    id: string;
    empresa_id: string;
    tarefa_id: string;
    autor_pessoa_id: string | null;
    autor_agente_id: string | null;
    texto: string;
    criado_em: Date;
  }>(
    `select id, empresa_id, tarefa_id, autor_pessoa_id, autor_agente_id, texto, criado_em
       from comentarios_de_tarefa where tarefa_id = $1 and empresa_id = empresa_ativa() order by criado_em, id`,
    [tarefaId],
  );
  return r.rows.map((l) => ({
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId: l.tarefa_id,
    autor: autorDaLinha(l.autor_pessoa_id, l.autor_agente_id),
    texto: l.texto,
    criadoEm: l.criado_em.toISOString(),
  }));
}

/** A pessoa tem vínculo ativo na empresa ativa (só assim pode ser responsável por uma tarefa). */
export async function pessoaAtivaNaEmpresa(c: pg.PoolClient, pessoaId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(pessoaId)) return false;
  const r = await c.query(
    "select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo'",
    [pessoaId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function criarTarefa(
  c: pg.PoolClient,
  quem: Quem,
  dados: { titulo: string; descricao: string | null; responsavel: Responsavel | null },
): Promise<Tarefa> {
  const [respPessoa, respAgente] = colunas(dados.responsavel);
  const [porPessoa, porAgente] = colunas(autorDe(quem));
  const r = await c.query<LinhaDaTarefa>(
    `insert into tarefas as t (empresa_id, titulo, descricao, responsavel_pessoa_id, responsavel_agente_id,
                            criada_por_pessoa_id, criada_por_agente_id)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6) returning ${COLUNAS}`,
    [dados.titulo.trim(), dados.descricao?.trim() || null, respPessoa, respAgente, porPessoa, porAgente],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/**
 * Muda o status. Concluir guarda o resultado (se houver) e quem entregou; encerrar ou voltar para A fazer
 * solta a trava; sair de Concluída apaga o resultado.
 */
export async function mudarStatus(
  c: pg.PoolClient,
  quem: Quem,
  tarefa: Tarefa,
  status: StatusTarefa,
  resultado: string | null,
): Promise<Tarefa> {
  const encerra = status === "concluida" || status === "cancelada";
  const soltaTrava = encerra || status === "a_fazer";
  const [porPessoa, porAgente] = status === "concluida" && resultado ? colunas(autorDe(quem)) : [null, null];
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set status = $2,
        encerrada_em = case when $3 then coalesce(t.encerrada_em, now()) else null end,
        travada_por_pessoa_id = case when $4 then null else t.travada_por_pessoa_id end,
        travada_por_agente_id = case when $4 then null else t.travada_por_agente_id end,
        travada_em = case when $4 then null else t.travada_em end,
        resultado = $5, resultado_por_pessoa_id = $6, resultado_por_agente_id = $7,
        atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      tarefa.id,
      status,
      encerra,
      soltaTrava,
      status === "concluida" ? resultado?.trim() || null : null,
      porPessoa,
      porAgente,
    ],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

export async function trocarResponsavel(
  c: pg.PoolClient,
  tarefa: Tarefa,
  responsavel: Responsavel | null,
): Promise<Tarefa> {
  const [pessoa, agente] = colunas(responsavel);
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set responsavel_pessoa_id = $2, responsavel_agente_id = $3, atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [tarefa.id, pessoa, agente],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/** Acrescenta um comentário (de quem pede ou do sistema) e marca a tarefa como atualizada. */
export async function comentar(
  c: pg.PoolClient,
  autor: Autor,
  tarefaId: string,
  texto: string,
): Promise<ComentarioDeTarefa> {
  const [pessoa, agente] = colunas(autor);
  const r = await c.query<{ id: string; empresa_id: string; criado_em: Date }>(
    `insert into comentarios_de_tarefa (empresa_id, tarefa_id, autor_pessoa_id, autor_agente_id, texto)
     values (empresa_ativa(), $1, $2, $3, $4) returning id, empresa_id, criado_em`,
    [tarefaId, pessoa, agente, texto.trim()],
  );
  await c.query("update tarefas set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    tarefaId,
  ]);
  const l = r.rows[0] as { id: string; empresa_id: string; criado_em: Date };
  return {
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId,
    autor,
    texto: texto.trim(),
    criadoEm: l.criado_em.toISOString(),
  };
}

export async function excluirTarefa(c: pg.PoolClient, tarefaId: string): Promise<void> {
  await c.query("delete from tarefas where id = $1 and empresa_id = empresa_ativa()", [tarefaId]);
}

/** Nomes das pessoas citadas nas tarefas e comentários (responsável, quem criou, quem comentou). */
export async function nomesDasPessoas(
  c: pg.PoolClient,
  ids: Iterable<string>,
): Promise<Record<string, string>> {
  const lista = [...new Set(ids)];
  if (lista.length === 0) return {};
  const r = await c.query<{ id: string; nome: string }>(
    "select id, nome from pessoas where id = any($1::uuid[])",
    [lista],
  );
  return Object.fromEntries(r.rows.map((l) => [l.id, l.nome]));
}

/** Os ids de pessoas que aparecem numa tarefa e nos comentários dela. */
export function pessoasCitadas(tarefas: Tarefa[], comentarios: ComentarioDeTarefa[] = []): string[] {
  const ids: string[] = [];
  const somar = (a: Autor | Responsavel | null) => {
    if (a?.tipo === "pessoa") ids.push(a.pessoaId);
  };
  for (const t of tarefas) {
    somar(t.responsavel);
    somar(t.criadaPor);
    somar(t.trava?.por ?? null);
    somar(t.resultadoPor);
  }
  for (const c of comentarios) somar(c.autor);
  return ids;
}
