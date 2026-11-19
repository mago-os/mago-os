/**
 * Espaços e projetos (M3-01). Cada função roda dentro da transação que o chamador abriu (comPessoa), então o banco
 * já isola a empresa. Aqui fica o "quem vê o quê" dos projetos: todos, ou só os que a pessoa é membro.
 */
import type {
  Espaco,
  MembroDoProjeto,
  Projeto,
  Responsavel,
  SituacaoDeOrganizacao,
} from "@mago-os/contratos";
import type pg from "pg";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COR_PADRAO = "#1aa39a";

/** Até onde a pessoa alcança os projetos: todos, só os que é membro, ou só os que dirige (para editar). */
export type AlcanceDeProjeto = "todos" | "membro" | "diretor";

interface LinhaDoEspaco {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  situacao: SituacaoDeOrganizacao;
  criado_em: Date;
  atualizado_em: Date;
}

const paraEspaco = (l: LinhaDoEspaco): Espaco => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  descricao: l.descricao,
  cor: l.cor,
  situacao: l.situacao,
  criadoEm: l.criado_em.toISOString(),
  atualizadoEm: l.atualizado_em.toISOString(),
});

const COLUNAS_DO_ESPACO =
  "e.id, e.empresa_id, e.nome, e.descricao, e.cor, e.situacao, e.criado_em, e.atualizado_em";

export async function listarEspacos(c: pg.PoolClient, arquivados: boolean): Promise<Espaco[]> {
  const r = await c.query<LinhaDoEspaco>(
    `select ${COLUNAS_DO_ESPACO} from espacos e
      where e.empresa_id = empresa_ativa() and ($1 or e.situacao = 'ativo') order by lower(e.nome), e.id`,
    [arquivados],
  );
  return r.rows.map(paraEspaco);
}

export async function buscarEspaco(c: pg.PoolClient, id: string, paraMudar = false): Promise<Espaco | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDoEspaco>(
    `select ${COLUNAS_DO_ESPACO} from espacos e where e.id = $1 and e.empresa_id = empresa_ativa()
      ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraEspaco(r.rows[0]) : null;
}

export async function criarEspaco(
  c: pg.PoolClient,
  d: { nome: string; descricao: string | null; cor: string },
): Promise<Espaco> {
  const r = await c.query<LinhaDoEspaco>(
    `insert into espacos as e (empresa_id, nome, descricao, cor) values (empresa_ativa(), $1, $2, $3)
     returning ${COLUNAS_DO_ESPACO}`,
    [d.nome.trim(), d.descricao?.trim() || null, d.cor],
  );
  return paraEspaco(r.rows[0] as LinhaDoEspaco);
}

export async function editarEspaco(c: pg.PoolClient, e: Espaco): Promise<Espaco> {
  const r = await c.query<LinhaDoEspaco>(
    `update espacos e set nome = $2, descricao = $3, cor = $4, situacao = $5, atualizado_em = now()
      where e.id = $1 and e.empresa_id = empresa_ativa() returning ${COLUNAS_DO_ESPACO}`,
    [e.id, e.nome.trim(), e.descricao?.trim() || null, e.cor, e.situacao],
  );
  return paraEspaco(r.rows[0] as LinhaDoEspaco);
}

interface LinhaDoProjeto {
  id: string;
  empresa_id: string;
  espaco_id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  situacao: SituacaoDeOrganizacao;
  diretor_id: string;
  gerente_pessoa_id: string | null;
  gerente_agente_id: string | null;
  gerente_recebe_sem_responsavel: boolean;
  inicio: string | null;
  fim: string | null;
  criado_em: Date;
  atualizado_em: Date;
  membros: { pessoa_id: string | null; agente_id: string | null }[];
}

// Datas sem hora voltam como texto (to_char), para o fuso do servidor não mudar o dia.
const COLUNAS_DO_PROJETO = `p.id, p.empresa_id, p.espaco_id, p.nome, p.descricao, p.cor, p.situacao, p.diretor_id,
  p.gerente_pessoa_id, p.gerente_agente_id, p.gerente_recebe_sem_responsavel,
  to_char(p.inicio, 'YYYY-MM-DD') as inicio, to_char(p.fim, 'YYYY-MM-DD') as fim, p.criado_em, p.atualizado_em,
  coalesce((select json_agg(json_build_object('pessoa_id', m.pessoa_id, 'agente_id', m.agente_id) order by m.criado_em, m.id)
              from membros_de_projeto m where m.projeto_id = p.id), '[]'::json) as membros`;

function gerenteDe(l: LinhaDoProjeto): Responsavel | null {
  if (l.gerente_pessoa_id) return { tipo: "pessoa", pessoaId: l.gerente_pessoa_id };
  if (l.gerente_agente_id) return { tipo: "agente", agenteId: l.gerente_agente_id };
  return null;
}

function paraProjeto(l: LinhaDoProjeto): Projeto {
  const gerente = gerenteDe(l);
  const membros: MembroDoProjeto[] = [{ quem: { tipo: "pessoa", pessoaId: l.diretor_id }, papel: "diretor" }];
  if (gerente) membros.push({ quem: gerente, papel: "gerente" });
  for (const m of l.membros) {
    membros.push({
      quem: m.pessoa_id
        ? { tipo: "pessoa", pessoaId: m.pessoa_id }
        : { tipo: "agente", agenteId: m.agente_id as string },
      papel: "membro",
    });
  }
  return {
    id: l.id,
    empresaId: l.empresa_id,
    espacoId: l.espaco_id,
    nome: l.nome,
    descricao: l.descricao,
    cor: l.cor,
    situacao: l.situacao,
    diretorId: l.diretor_id,
    gerente,
    membros,
    gerenteRecebeSemResponsavel: l.gerente_recebe_sem_responsavel,
    inicio: l.inicio,
    fim: l.fim,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

/** Condição SQL (sobre "p") dos projetos que a pessoa alcança. O valor $N é a pessoa. */
function condicaoDoProjeto(alcance: AlcanceDeProjeto, n: number): string {
  // A pessoa entra na consulta mesmo quando não filtra, para o banco saber o tipo do valor.
  if (alcance === "todos") return `($${n}::uuid is not null or true)`;
  if (alcance === "diretor") return `p.diretor_id = $${n}`;
  return `membro_do_projeto(p.id, $${n})`;
}

export async function listarProjetos(
  c: pg.PoolClient,
  pessoaId: string,
  alcance: AlcanceDeProjeto,
  filtro: { espacoId?: string; arquivados?: boolean },
): Promise<Projeto[]> {
  const valores: unknown[] = [pessoaId, filtro.arquivados === true];
  const partes = [condicaoDoProjeto(alcance, 1), "($2 or p.situacao = 'ativo')"];
  if (filtro.espacoId) {
    if (!FORMATO_UUID.test(filtro.espacoId)) return [];
    valores.push(filtro.espacoId);
    partes.push(`p.espaco_id = $${valores.length}`);
  }
  const r = await c.query<LinhaDoProjeto>(
    `select ${COLUNAS_DO_PROJETO} from projetos p
      where p.empresa_id = empresa_ativa() and ${partes.join(" and ")} order by lower(p.nome), p.id limit 500`,
    valores,
  );
  return r.rows.map(paraProjeto);
}

/** O projeto, se a pessoa o alcança. "Para mudar" trava a linha até o fim da transação. */
export async function buscarProjeto(
  c: pg.PoolClient,
  pessoaId: string,
  alcance: AlcanceDeProjeto,
  id: string,
  paraMudar = false,
): Promise<Projeto | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDoProjeto>(
    `select ${COLUNAS_DO_PROJETO} from projetos p
      where p.id = $2 and p.empresa_id = empresa_ativa() and ${condicaoDoProjeto(alcance, 1)}
      ${paraMudar ? "for no key update of p" : ""}`,
    [pessoaId, id],
  );
  return r.rows[0] ? paraProjeto(r.rows[0]) : null;
}

export interface DadosDoProjeto {
  espacoId: string;
  nome: string;
  descricao: string | null;
  cor: string;
  diretorId: string;
  gerente: Responsavel | null;
  /** Só os membros comuns (sem o diretor e o gerente). */
  membros: Responsavel[];
  gerenteRecebeSemResponsavel: boolean;
  inicio: string | null;
  fim: string | null;
  situacao: SituacaoDeOrganizacao;
}

const chave = (r: Responsavel) => (r.tipo === "pessoa" ? `p:${r.pessoaId}` : `a:${r.agenteId}`);

/** Tira repetidos e quem já é diretor ou gerente da lista de membros comuns. */
export function membrosComuns(d: Pick<DadosDoProjeto, "diretorId" | "gerente" | "membros">): Responsavel[] {
  const fora = new Set([`p:${d.diretorId}`, ...(d.gerente ? [chave(d.gerente)] : [])]);
  const vistos = new Set<string>();
  return d.membros.filter((m) => {
    const k = chave(m);
    if (fora.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** Deixa os membros comuns iguais à lista: apaga só quem saiu e acrescenta só quem entrou. */
async function gravarMembros(c: pg.PoolClient, projetoId: string, membros: Responsavel[]): Promise<void> {
  const pessoas = membros.flatMap((m) => (m.tipo === "pessoa" ? [m.pessoaId] : []));
  const agentes = membros.flatMap((m) => (m.tipo === "agente" ? [m.agenteId] : []));
  await c.query(
    `delete from membros_de_projeto where projeto_id = $1 and empresa_id = empresa_ativa()
        and not (coalesce(pessoa_id = any($2::uuid[]), false) or coalesce(agente_id = any($3::uuid[]), false))`,
    [projetoId, pessoas, agentes],
  );
  await c.query(
    `insert into membros_de_projeto (empresa_id, projeto_id, pessoa_id)
     select empresa_ativa(), $1, x from unnest($2::uuid[]) as x
      where not exists (select 1 from membros_de_projeto m where m.projeto_id = $1 and m.pessoa_id = x)`,
    [projetoId, pessoas],
  );
  await c.query(
    `insert into membros_de_projeto (empresa_id, projeto_id, agente_id)
     select empresa_ativa(), $1, x from unnest($2::uuid[]) as x
      where not exists (select 1 from membros_de_projeto m where m.projeto_id = $1 and m.agente_id = x)`,
    [projetoId, agentes],
  );
}

function colunasDoGerente(g: Responsavel | null): [string | null, string | null] {
  if (g?.tipo === "pessoa") return [g.pessoaId, null];
  if (g?.tipo === "agente") return [null, g.agenteId];
  return [null, null];
}

export async function criarProjeto(c: pg.PoolClient, d: DadosDoProjeto): Promise<Projeto> {
  const [gPessoa, gAgente] = colunasDoGerente(d.gerente);
  const r = await c.query<{ id: string }>(
    `insert into projetos (empresa_id, espaco_id, nome, descricao, cor, diretor_id, gerente_pessoa_id,
                           gerente_agente_id, gerente_recebe_sem_responsavel, inicio, fim)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      d.espacoId,
      d.nome.trim(),
      d.descricao?.trim() || null,
      d.cor,
      d.diretorId,
      gPessoa,
      gAgente,
      d.gerenteRecebeSemResponsavel,
      d.inicio,
      d.fim,
    ],
  );
  const id = (r.rows[0] as { id: string }).id;
  await gravarMembros(c, id, membrosComuns(d));
  return (await buscarProjeto(c, d.diretorId, "todos", id)) as Projeto;
}

export async function editarProjeto(
  c: pg.PoolClient,
  id: string,
  d: DadosDoProjeto,
  /** Só regrava os membros quando diretor, gerente ou a lista mudaram. */
  regravarMembros = true,
): Promise<Projeto> {
  const [gPessoa, gAgente] = colunasDoGerente(d.gerente);
  await c.query(
    `update projetos set espaco_id = $2, nome = $3, descricao = $4, cor = $5, diretor_id = $6,
            gerente_pessoa_id = $7, gerente_agente_id = $8, gerente_recebe_sem_responsavel = $9,
            inicio = $10, fim = $11, situacao = $12, atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [
      id,
      d.espacoId,
      d.nome.trim(),
      d.descricao?.trim() || null,
      d.cor,
      d.diretorId,
      gPessoa,
      gAgente,
      d.gerenteRecebeSemResponsavel,
      d.inicio,
      d.fim,
      d.situacao,
    ],
  );
  if (regravarMembros) await gravarMembros(c, id, membrosComuns(d));
  return (await buscarProjeto(c, d.diretorId, "todos", id)) as Projeto;
}

/** Exclui de vez (só o administrador, e só projeto sem tarefas). Devolve falso se ainda há tarefas. */
export async function excluirProjeto(c: pg.PoolClient, id: string): Promise<boolean> {
  const t = await c.query(
    "select 1 from tarefas where projeto_id = $1 and empresa_id = empresa_ativa() limit 1",
    [id],
  );
  if ((t.rowCount ?? 0) > 0) return false;
  await c.query("delete from projetos where id = $1 and empresa_id = empresa_ativa()", [id]);
  return true;
}

/** Quantas tarefas abertas cada projeto tem (para as listas). */
export async function tarefasAbertasPorProjeto(
  c: pg.PoolClient,
  ids: string[],
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const r = await c.query<{ projeto_id: string; abertas: number }>(
    `select projeto_id, count(*)::int as abertas from tarefas
      where empresa_id = empresa_ativa() and projeto_id = any($1::uuid[])
        and status not in ('concluida', 'cancelada')
      group by projeto_id`,
    [ids],
  );
  return Object.fromEntries(r.rows.map((l) => [l.projeto_id, l.abertas]));
}
