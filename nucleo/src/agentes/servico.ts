/**
 * Agentes (M2-03): cadastro, situação e o que acontece com as tarefas quando o agente para.
 * Cada função roda dentro da transação do chamador (comPessoa ou comEmpresa), então o banco já isola a empresa.
 */
import type { Agente, SituacaoAgente } from "@mago-os/contratos";
import type pg from "pg";
import type { Filtro } from "../permissoes/calcular.ts";
import { comentar } from "../tarefas/servico.ts";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUNAS = `a.id, a.empresa_id, a.nome, a.descricao, a.tipo, a.onde_roda, a.responsavel_id, a.situacao,
  a.minutos_sem_sinal, a.ultimo_sinal_em, a.criado_em, a.atualizado_em, a.desligado_em`;

interface LinhaDoAgente {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  tipo: "externo";
  onde_roda: string | null;
  responsavel_id: string;
  situacao: SituacaoAgente;
  minutos_sem_sinal: number;
  ultimo_sinal_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
  desligado_em: Date | null;
}

export function linhaParaAgente(l: LinhaDoAgente): Agente {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    nome: l.nome,
    descricao: l.descricao,
    tipo: l.tipo,
    ondeRoda: l.onde_roda,
    responsavelId: l.responsavel_id,
    situacao: l.situacao,
    minutosSemSinal: l.minutos_sem_sinal,
    ultimoSinalEm: l.ultimo_sinal_em ? l.ultimo_sinal_em.toISOString() : null,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
    desligadoEm: l.desligado_em ? l.desligado_em.toISOString() : null,
  };
}

/** O agente na lista: com o nome do responsável e quantas tarefas abertas ele tem. */
export interface AgenteNaLista extends Agente {
  responsavelNome: string;
  tarefasAbertas: number;
}

export async function listarAgentes(c: pg.PoolClient, soEste?: string): Promise<AgenteNaLista[]> {
  if (soEste !== undefined && !FORMATO_UUID.test(soEste)) return [];
  const r = await c.query<LinhaDoAgente & { responsavel_nome: string; tarefas_abertas: number }>(
    `select ${COLUNAS}, p.nome as responsavel_nome,
            (select count(*)::int from tarefas t where t.empresa_id = a.empresa_id
               and (t.responsavel_agente_id = a.id or t.travada_por_agente_id = a.id)
               and t.status not in ('concluida', 'cancelada')) as tarefas_abertas
       from agentes a join pessoas p on p.id = a.responsavel_id
      where a.empresa_id = empresa_ativa() and ($1::uuid is null or a.id = $1)
      order by (a.situacao = 'desligado'), lower(a.nome)`,
    [soEste ?? null],
  );
  return r.rows.map((l) => ({
    ...linhaParaAgente(l),
    responsavelNome: l.responsavel_nome,
    tarefasAbertas: l.tarefas_abertas,
  }));
}

export async function buscarAgente(c: pg.PoolClient, id: string, paraMudar = false): Promise<Agente | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDoAgente>(
    `select ${COLUNAS} from agentes a where a.id = $1 and a.empresa_id = empresa_ativa()
      ${paraMudar ? "for update" : ""}`,
    [id],
  );
  const linha = r.rows[0];
  return linha ? linhaParaAgente(linha) : null;
}

/** Só agente ativo da empresa recebe tarefa nova (pausado e desligado não). */
export async function agenteRecebeTarefas(c: pg.PoolClient, agenteId: string): Promise<boolean> {
  if (!FORMATO_UUID.test(agenteId)) return false;
  const r = await c.query(
    // "for share": um desligamento ao mesmo tempo espera esta transação, e a tarefa não fica com agente desligado.
    "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and situacao = 'ativo' for share",
    [agenteId],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface DadosDoAgente {
  nome: string;
  descricao: string | null;
  ondeRoda: string | null;
  responsavelId: string;
  minutosSemSinal: number;
}

export async function cadastrarAgente(c: pg.PoolClient, d: DadosDoAgente): Promise<Agente> {
  const r = await c.query<LinhaDoAgente>(
    `insert into agentes as a (empresa_id, nome, descricao, onde_roda, responsavel_id, minutos_sem_sinal)
     values (empresa_ativa(), $1, $2, $3, $4, $5) returning ${COLUNAS}`,
    [
      d.nome.trim(),
      d.descricao?.trim() || null,
      d.ondeRoda?.trim() || null,
      d.responsavelId,
      d.minutosSemSinal,
    ],
  );
  return linhaParaAgente(r.rows[0] as LinhaDoAgente);
}

export async function editarAgente(c: pg.PoolClient, atual: Agente, d: DadosDoAgente): Promise<Agente> {
  const r = await c.query<LinhaDoAgente>(
    `update agentes a set nome = $2, descricao = $3, onde_roda = $4, responsavel_id = $5, minutos_sem_sinal = $6,
            atualizado_em = now()
      where a.id = $1 and a.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      atual.id,
      d.nome.trim(),
      d.descricao?.trim() || null,
      d.ondeRoda?.trim() || null,
      d.responsavelId,
      d.minutosSemSinal,
    ],
  );
  return linhaParaAgente(r.rows[0] as LinhaDoAgente);
}

export async function mudarSituacao(
  c: pg.PoolClient,
  agenteId: string,
  situacao: SituacaoAgente,
): Promise<Agente> {
  const r = await c.query<LinhaDoAgente>(
    `update agentes a set situacao = $2, atualizado_em = now(),
            desligado_em = case when $2 = 'desligado' then now() else null end
      where a.id = $1 and a.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [agenteId, situacao],
  );
  return linhaParaAgente(r.rows[0] as LinhaDoAgente);
}

export interface TarefaDevolvida {
  id: string;
  titulo: string;
}

/**
 * Devolve para A fazer as tarefas que o agente tinha pegado (M2-03 ao desligar; M2-04 quando fica sem sinal),
 * com um comentário do sistema em cada uma. Devolve a lista para avisar o responsável.
 */
export async function devolverTarefasPegadas(
  c: pg.PoolClient,
  agenteId: string,
  motivo: string,
): Promise<TarefaDevolvida[]> {
  const r = await c.query<TarefaDevolvida>(
    `update tarefas set status = 'a_fazer', travada_por_agente_id = null, travada_em = null, atualizada_em = now()
      where empresa_id = empresa_ativa() and travada_por_agente_id = $1 returning id, titulo`,
    [agenteId],
  );
  for (const t of r.rows) await comentar(c, { tipo: "sistema" }, t.id, motivo);
  return r.rows;
}

/**
 * Ao desligar: as tarefas abertas que eram do agente passam para a pessoa responsável por ele, para nenhuma
 * ficar esquecida com um agente que não volta.
 */
export async function passarTarefasAoResponsavel(
  c: pg.PoolClient,
  agente: Agente,
  jaComentadas: ReadonlySet<string> = new Set(),
): Promise<TarefaDevolvida[]> {
  // Se a pessoa responsável já saiu da empresa, a tarefa fica sem responsável (e não com quem saiu).
  const r = await c.query<TarefaDevolvida & { com_pessoa: boolean }>(
    `update tarefas set responsavel_agente_id = null,
            responsavel_pessoa_id = (select v.pessoa_id from vinculos v where v.empresa_id = empresa_ativa()
                                       and v.pessoa_id = $2 and v.situacao = 'ativo'),
            atualizada_em = now()
      where empresa_id = empresa_ativa() and responsavel_agente_id = $1
        and status not in ('concluida', 'cancelada')
      returning id, titulo, responsavel_pessoa_id is not null as com_pessoa`,
    [agente.id, agente.responsavelId],
  );
  for (const t of r.rows) {
    if (jaComentadas.has(t.id)) continue;
    await comentar(
      c,
      { tipo: "sistema" },
      t.id,
      t.com_pessoa
        ? `O agente ${agente.nome} foi desligado e a tarefa passou para a pessoa responsável por ele.`
        : `O agente ${agente.nome} foi desligado e a tarefa ficou sem responsável.`,
    );
  }
  return r.rows.map(({ id, titulo }) => ({ id, titulo }));
}

/**
 * O alcance da permissão vale também para os agentes: "meus" são os agentes de que a pessoa é responsável;
 * "equipe", também os de responsáveis da área dela.
 */
export async function alcanceCobreAgente(c: pg.PoolClient, filtro: Filtro, agente: Agente): Promise<boolean> {
  if (filtro.tipo === "tudo") return true;
  if (agente.responsavelId === filtro.pessoaId) return true;
  if (filtro.tipo === "meus") return false;
  const r = await c.query(
    "select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and area = $2",
    [agente.responsavelId, filtro.area],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Nome e e-mail da pessoa responsável, para o aviso. */
export async function contatoDoResponsavel(
  c: pg.PoolClient,
  pessoaId: string,
): Promise<{ nome: string; email: string } | null> {
  const r = await c.query<{ nome: string; email: string }>("select nome, email from pessoas where id = $1", [
    pessoaId,
  ]);
  return r.rows[0] ?? null;
}
