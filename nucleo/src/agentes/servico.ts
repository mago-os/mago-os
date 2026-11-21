/**
 * Agentes (M2-03): cadastro, situação e o que acontece com as tarefas quando o agente para.
 * Cada função roda dentro da transação do chamador (comPessoa ou comEmpresa), então o banco já isola a empresa.
 */
import type { Agente, SituacaoAgente } from "@mago-os/contratos";
import type pg from "pg";
import type { Filtro } from "../permissoes/calcular.ts";
import { comentar } from "../tarefas/servico.ts";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUNAS = `a.id, a.empresa_id, a.nome, a.descricao, a.tipo, a.onde_roda, a.responsavel_id, a.papel,
  a.especialidade, a.responde_a_id, a.situacao, a.minutos_sem_sinal, a.ultimo_sinal_em, a.criado_em, a.atualizado_em,
  a.desligado_em`;

interface LinhaDoAgente {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  tipo: Agente["tipo"];
  onde_roda: string | null;
  responsavel_id: string;
  papel: Agente["papel"];
  especialidade: Agente["especialidade"];
  responde_a_id: string | null;
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
    papel: l.papel,
    especialidade: l.especialidade,
    respondeAId: l.responde_a_id,
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
  // Retomado começa a contar o limite de pedidos do zero (senão volta a ser pausado no primeiro pedido).
  if (situacao === "ativo") {
    await c.query(
      "delete from contadores_de_agente where empresa_id = empresa_ativa() and agente_id = $1 and janela = 'pedidos_minuto'",
      [agenteId],
    );
  }
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

/**
 * Os dois agentes de nascença (M4-02, decisão 0023): o Coordenador e o Gerente de projetos, pausados até o modelo ser
 * escolhido. As empresas que já existiam ganharam os dois na migração; as novas, aqui, no primeiro uso. O responsável
 * é o administrador mais antigo. Roda na transação de quem chamou; não faz nada se já existem.
 */
export async function garantirAgentesDeNascenca(c: pg.PoolClient): Promise<void> {
  // Desligar é definitivo: se o coordenador (ou o Gerente) foi desligado, nasce um novo, pausado.
  const vivos = await c.query<{
    id: string;
    papel: string;
    especialidade: string | null;
    responde_a_id: string | null;
  }>(
    `select id, papel, especialidade, responde_a_id from agentes
      where empresa_id = empresa_ativa() and tipo = 'interno' and situacao <> 'desligado'`,
  );
  let coordenadorId = vivos.rows.find((a) => a.papel === "coordenador")?.id ?? null;
  const gerente = vivos.rows.find((a) => a.especialidade === "gerente_de_projetos");
  if (coordenadorId && gerente && gerente.responde_a_id === coordenadorId) return;
  const dono = await c.query<{ pessoa_id: string }>(
    `select pessoa_id from vinculos where empresa_id = empresa_ativa() and perfil = 'administrador'
        and situacao = 'ativo' order by entrou_em nulls last, pessoa_id limit 1`,
  );
  const responsavel = dono.rows[0]?.pessoa_id;
  if (!responsavel) return;
  if (!coordenadorId) {
    // Duas pessoas abrindo ao mesmo tempo: o índice de um coordenador por empresa barra a segunda (on conflict).
    const novo = await c.query<{ id: string }>(
      `insert into agentes (empresa_id, nome, descricao, tipo, responsavel_id, situacao, papel)
       select empresa_ativa(), 'Coordenador', 'Recebe os pedidos no app e passa ao especialista certo.', 'interno',
              $1, 'pausado', 'coordenador'
        where not exists (select 1 from agentes where empresa_id = empresa_ativa() and lower(nome) = 'coordenador'
                            and situacao <> 'desligado')
       on conflict do nothing returning id`,
      [responsavel],
    );
    coordenadorId = novo.rows[0]?.id ?? null;
    if (!coordenadorId) return;
  }
  if (gerente) {
    // O Gerente que respondia ao coordenador desligado passa a responder ao novo.
    if (gerente.responde_a_id !== coordenadorId)
      await c.query(
        "update agentes set responde_a_id = $2, atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()",
        [gerente.id, coordenadorId],
      );
    return;
  }
  const novoGerente = await c.query<{ id: string }>(
    `insert into agentes (empresa_id, nome, descricao, tipo, responsavel_id, situacao, papel, especialidade,
       responde_a_id)
     select empresa_ativa(), 'Gerente de projetos',
            'Planeja tarefas em subtarefas e checklist, distribui e acompanha prazos.', 'interno', $1, 'pausado',
            'especialista', 'gerente_de_projetos', $2
      where not exists (select 1 from agentes where empresa_id = empresa_ativa()
                          and lower(nome) = 'gerente de projetos' and situacao <> 'desligado')
     on conflict do nothing returning id`,
    [responsavel, coordenadorId],
  );
  // O Gerente nasce com a skill da plataforma "planejar-tarefas" (M4-05).
  if (novoGerente.rows[0])
    await c.query(
      `insert into skills_do_agente (empresa_id, agente_id, skill_da_plataforma)
       values (empresa_ativa(), $1, 'planejar-tarefas') on conflict do nothing`,
      [novoGerente.rows[0].id],
    );
}
