/**
 * Tarefas (M2-01): o que se faz com uma tarefa, igual para as rotas da tela e, a partir da M2-05, para o MCP.
 *
 * Cada função roda dentro da transação que o chamador abriu (comPessoa ou, para agentes, a da M2-04), então o
 * banco já isola a empresa. Aqui fica o "quem vê o quê": o alcance da verificação central vira a condição SQL.
 * As regras de formato do contrato também estão no banco (migração 0013), como segunda barreira.
 */
import type {
  Autor,
  ComentarioDeTarefa,
  FiltroDeTarefas,
  Prioridade,
  RegraDeRecorrencia,
  Responsavel,
  StatusTarefa,
  Tarefa,
  TipoDeComentario,
} from "@mago-os/contratos";
import type pg from "pg";
import type { Filtro } from "../permissoes/calcular.ts";

/**
 * Quem está pedindo: uma pessoa (com o alcance da ação) ou um agente (as tarefas dele, M2-03).
 * "projetos" diz quais projetos a pessoa alcança além do alcance da ação (M3-01): "todos" (quem vê todos os
 * projetos, só para ver), "membro" (os projetos em que é diretora, gerente ou membro, para ver e editar) ou
 * "nenhum". "comoGerente": só para ver (e comentar), o agente alcança também as tarefas do projeto que gerencia, as
 * subtarefas das que alcança e as tarefas em que foi mencionado (M3-05).
 */
export type Quem =
  | { tipo: "pessoa"; pessoaId: string; filtro: Filtro; projetos?: "todos" | "membro" | "nenhum" }
  | { tipo: "agente"; agenteId: string; comoGerente?: boolean };

export function autorDe(quem: Quem): Autor {
  return quem.tipo === "pessoa"
    ? { tipo: "pessoa", pessoaId: quem.pessoaId }
    : { tipo: "agente", agenteId: quem.agenteId };
}

/**
 * Condição SQL (sobre a tabela "t") das tarefas que quem pede alcança. "jaUsados": quantos valores a consulta já
 * tem. A subtarefa segue a mãe (M3-02): quem alcança a tarefa-mãe alcança as subtarefas dela.
 */
export function condicaoDeAlcance(quem: Quem, jaUsados: number): { sql: string; valores: string[] } {
  const { sql, valores } = alcanceSobre("t", quem, jaUsados);
  // Para o agente, a mãe só abre as subtarefas para ver (como o gerente): mexer, só nas dele.
  if (sql === "true" || (quem.tipo === "agente" && !quem.comoGerente)) return { sql, valores };
  const daMae = alcanceSobre("m", quem, jaUsados).sql;
  return {
    sql: `(${sql} or (t.tarefa_mae_id is not null and exists (select 1 from tarefas m
             where m.id = t.tarefa_mae_id and m.empresa_id = t.empresa_id and ${daMae})))`,
    valores,
  };
}

/** A condição de alcance sobre uma tabela de tarefas com o apelido dado ("t" ou "m"). */
function alcanceSobre(a: string, quem: Quem, jaUsados: number): { sql: string; valores: string[] } {
  const p = (n: number) => `$${jaUsados + n + 1}`;
  if (quem.tipo === "agente") {
    const dele = `(${a}.responsavel_agente_id = ${p(0)} or ${a}.travada_por_agente_id = ${p(0)})`;
    if (!quem.comoGerente) return { sql: dele, valores: [quem.agenteId] };
    // Só para ver (e comentar): o gerente agente enxerga as tarefas do projeto dele (M3-01), e o agente mencionado
    // com @ num comentário enxerga aquela tarefa (M3-05). Mexer, só nas dele.
    return {
      sql: `(${dele} or exists (select 1 from projetos pr where pr.id = ${a}.projeto_id
             and pr.empresa_id = ${a}.empresa_id and pr.gerente_agente_id = ${p(0)})
             or exists (select 1 from mencoes_de_comentario mc join comentarios_de_tarefa cm on cm.id = mc.comentario_id
                         where mc.tarefa_id = ${a}.id and mc.empresa_id = ${a}.empresa_id and mc.agente_id = ${p(0)}
                           and cm.tipo = 'comentario' and cm.apagado_em is null))`,
      valores: [quem.agenteId],
    };
  }
  // "Meus": sou o responsável, criei ou estou com a tarefa pegada.
  const meus = `(${a}.responsavel_pessoa_id = ${p(0)} or ${a}.criada_por_pessoa_id = ${p(0)}
                 or ${a}.travada_por_pessoa_id = ${p(0)})`;
  // E as tarefas dos projetos que alcanço (M3-01): todos, ou os que sou membro.
  const doProjeto =
    quem.projetos === "todos"
      ? `${a}.projeto_id is not null`
      : quem.projetos === "membro"
        ? `(${a}.projeto_id is not null and membro_do_projeto(${a}.projeto_id, ${p(0)}))`
        : "false";
  const { filtro } = quem;
  if (filtro.tipo === "tudo") return { sql: "true", valores: [] };
  if (filtro.tipo === "meus") return { sql: `(${meus} or ${doProjeto})`, valores: [filtro.pessoaId] };
  return {
    sql: `(${meus} or ${doProjeto} or exists (select 1 from vinculos v where v.empresa_id = ${a}.empresa_id
             and v.area = ${p(1)}
             and v.pessoa_id in (${a}.responsavel_pessoa_id, ${a}.criada_por_pessoa_id, ${a}.travada_por_pessoa_id)))`,
    valores: [filtro.pessoaId, filtro.area],
  };
}

const COLUNAS = `t.id, t.empresa_id, t.titulo, t.descricao, t.projeto_id, t.lista_id, t.status_do_projeto_id,
  t.tarefa_mae_id, t.prioridade, to_char(t.prazo_dia, 'YYYY-MM-DD') as prazo_dia,
  to_char(t.prazo_hora, 'HH24:MI') as prazo_hora, t.prazo_fuso, t.prazo_em, to_char(t.inicio, 'YYYY-MM-DD') as inicio,
  t.recorrencia, t.ocorrencia, t.recorrente_de_id,
  coalesce((select array_agg(e.etiqueta_id order by e.etiqueta_id) from etiquetas_de_tarefa e
             where e.tarefa_id = t.id and e.empresa_id = t.empresa_id), '{}') as etiquetas,
  t.status,
  t.responsavel_pessoa_id, t.responsavel_agente_id, t.criada_por_pessoa_id, t.criada_por_agente_id,
  t.travada_por_pessoa_id, t.travada_por_agente_id, t.travada_em,
  t.resultado, t.resultado_por_pessoa_id, t.resultado_por_agente_id, t.criada_em, t.atualizada_em, t.encerrada_em`;

interface LinhaDaTarefa {
  id: string;
  empresa_id: string;
  titulo: string;
  descricao: string | null;
  projeto_id: string | null;
  lista_id: string | null;
  status_do_projeto_id: string | null;
  tarefa_mae_id: string | null;
  prioridade: Prioridade | null;
  prazo_dia: string | null;
  prazo_hora: string | null;
  prazo_fuso: string | null;
  prazo_em: Date | null;
  inicio: string | null;
  recorrencia: RegraDeRecorrencia | null;
  ocorrencia: number;
  recorrente_de_id: string | null;
  etiquetas: string[];
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
    projetoId: l.projeto_id,
    listaId: l.lista_id,
    statusDoProjetoId: l.status_do_projeto_id,
    tarefaMaeId: l.tarefa_mae_id,
    prioridade: l.prioridade,
    prazo:
      l.prazo_dia && l.prazo_fuso && l.prazo_em
        ? { dia: l.prazo_dia, hora: l.prazo_hora, fuso: l.prazo_fuso, em: l.prazo_em.toISOString() }
        : null,
    inicio: l.inicio,
    etiquetas: l.etiquetas,
    recorrencia: l.recorrencia,
    ocorrencia: l.ocorrencia,
    recorrenteDeId: l.recorrente_de_id,
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

/** Os filtros da lista (contrato FiltroDeTarefas). */
export type FiltroDaLista = FiltroDeTarefas;

/** Fuso de quem pede (o da pessoa; para agentes e o sistema, o da empresa), para "hoje" e o calendário. */
const FUSO_DE_QUEM_PEDE = `coalesce((select p.fuso_horario from pessoas p where p.id = pessoa_ativa()),
  (select e.fuso_horario from empresas e where e.id = empresa_ativa()), 'UTC')`;

/**
 * Os filtros da M3-04 (espaço, responsáveis, agente, prioridade, etiquetas, prazo, intervalo do calendário e
 * subtarefas), como condições SQL sobre "t". Acrescenta os valores em "valores".
 */
function filtrosDaM304(filtro: FiltroDaLista, valores: unknown[]): string[] {
  const partes: string[] = [];
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  if (filtro.espacoId) {
    partes.push(`t.projeto_id in (select pr.id from projetos pr where pr.espaco_id = ${v(filtro.espacoId)}
                  and pr.empresa_id = empresa_ativa())`);
  }
  if (filtro.responsaveis && filtro.responsaveis.length > 0) {
    const pessoas = filtro.responsaveis.flatMap((r) => (r.tipo === "pessoa" ? [r.pessoaId] : []));
    const agentes = filtro.responsaveis.flatMap((r) => (r.tipo === "agente" ? [r.agenteId] : []));
    partes.push(`(t.responsavel_pessoa_id = any(${v(pessoas)}::uuid[])
                  or t.responsavel_agente_id = any(${v(agentes)}::uuid[]))`);
  }
  if (filtro.deAgente)
    partes.push("(t.responsavel_agente_id is not null or t.travada_por_agente_id is not null)");
  if (filtro.prioridades && filtro.prioridades.length > 0) {
    const reais = filtro.prioridades.filter((p) => p !== "sem");
    const semPrioridade = filtro.prioridades.includes("sem");
    partes.push(
      `(t.prioridade = any(${v(reais)}::text[])${semPrioridade ? " or t.prioridade is null" : ""})`,
    );
  }
  if (filtro.etiquetas && filtro.etiquetas.length > 0) {
    partes.push(`exists (select 1 from etiquetas_de_tarefa et where et.tarefa_id = t.id
                  and et.empresa_id = t.empresa_id and et.etiqueta_id = any(${v(filtro.etiquetas)}::uuid[]))`);
  }
  // O dia do prazo como quem pede vê (no fuso dele) e o "hoje" dele.
  const diaDoPrazo = `(t.prazo_em at time zone ${FUSO_DE_QUEM_PEDE})::date`;
  const hoje = `(now() at time zone ${FUSO_DE_QUEM_PEDE})::date`;
  if (filtro.prazo === "atrasadas") {
    partes.push("(t.prazo_em < now() and t.status not in ('concluida', 'cancelada'))");
  } else if (filtro.prazo === "hoje") partes.push(`${diaDoPrazo} = ${hoje}`);
  else if (filtro.prazo === "semana") partes.push(`${diaDoPrazo} between ${hoje} and ${hoje} + 6`);
  else if (filtro.prazo === "sem_prazo") partes.push("t.prazo_em is null");
  // Calendário: o dia do prazo (no fuso de quem pede) cai dentro dos dias pedidos.
  if (filtro.de || filtro.ate) {
    const de = filtro.de ? `${v(filtro.de)}::date` : "'-infinity'::date";
    const ate = filtro.ate ? `${v(filtro.ate)}::date` : "'infinity'::date";
    partes.push(`(t.prazo_em is not null and ${diaDoPrazo} between ${de} and ${ate})`);
  }
  if (filtro.subtarefas === false) partes.push("t.tarefa_mae_id is null");
  // Texto livre: contém (sem acento e sem diferença de maiúsculas) ou uma palavra parecida no título; também na
  // descrição e nos comentários. Os curingas do LIKE valem como texto.
  if (filtro.texto) {
    const Q = `para_busca(${v(filtro.texto)}::text)`;
    const contem = `('%' || replace(replace(replace(${Q}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
    partes.push(`(para_busca(t.titulo) like ${contem} or ${Q} <% para_busca(t.titulo)
       or para_busca(coalesce(t.descricao, '')) like ${contem}
       or exists (select 1 from comentarios_de_tarefa k where k.tarefa_id = t.id and k.empresa_id = t.empresa_id
                    and k.apagado_em is null and para_busca(k.texto) like ${contem}))`);
  }
  return partes;
}

/** Lista as tarefas que quem pede alcança, as mais recentes primeiro (até 200 no M2). */
export async function listarTarefas(c: pg.PoolClient, quem: Quem, filtro: FiltroDaLista): Promise<Tarefa[]> {
  const alcance = condicaoDeAlcance(quem, 0);
  const valores: unknown[] = [...alcance.valores];
  const partes = [alcance.sql];
  // A lista do agente é sempre a dele (responsável ou com a trava), mesmo quando ele é gerente e alcança as
  // outras tarefas do projeto: é dessa lista que ele pega o próximo trabalho.
  if (quem.tipo === "agente") {
    valores.push(quem.agenteId);
    const eu = `$${valores.length}`;
    partes.push(`(t.responsavel_agente_id = ${eu} or t.travada_por_agente_id = ${eu})`);
  }
  if (filtro.minhas && quem.tipo === "pessoa") {
    valores.push(quem.pessoaId);
    const eu = `$${valores.length}`;
    partes.push(
      `(t.responsavel_pessoa_id = ${eu} or t.criada_por_pessoa_id = ${eu} or t.travada_por_pessoa_id = ${eu})`,
    );
  }
  if (filtro.status && filtro.status.length > 0) {
    valores.push(filtro.status);
    partes.push(`t.status = any($${valores.length}::text[])`);
  }
  if (filtro.projetoId === "sem") partes.push("t.projeto_id is null");
  else if (filtro.projetoId) {
    valores.push(filtro.projetoId);
    partes.push(`t.projeto_id = $${valores.length}`);
  }
  partes.push(...filtrosDaM304(filtro, valores));
  // O agente recebe das mais urgentes para as menos (M3-03): prioridade, depois o prazo mais perto. As telas, as
  // mais recentes primeiro (as visões da M3-04 ordenam como a pessoa escolher).
  const ordem =
    quem.tipo === "agente"
      ? `case t.prioridade when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 when 'baixa' then 3 else 4 end,
         t.prazo_em nulls last, t.atualizada_em desc`
      : "t.atualizada_em desc";
  const r = await c.query<LinhaDaTarefa>(
    `select ${COLUNAS} from tarefas t where t.empresa_id = empresa_ativa() and ${partes.join(" and ")}
      order by ${ordem} limit 200`,
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

interface LinhaDoComentario {
  id: string;
  empresa_id: string;
  tarefa_id: string;
  autor_pessoa_id: string | null;
  autor_agente_id: string | null;
  tipo: TipoDeComentario;
  texto: string | null;
  criado_em: Date;
  editado_em: Date | null;
  apagado_em: Date | null;
  mencoes: { pessoa_id: string | null; agente_id: string | null }[];
}

const COLUNAS_DO_COMENTARIO = `cm.id, cm.empresa_id, cm.tarefa_id, cm.autor_pessoa_id, cm.autor_agente_id, cm.tipo,
  cm.texto, cm.criado_em, cm.editado_em, cm.apagado_em,
  coalesce((select json_agg(json_build_object('pessoa_id', m.pessoa_id, 'agente_id', m.agente_id) order by m.id)
              from mencoes_de_comentario m where m.comentario_id = cm.id), '[]'::json) as mencoes`;

function paraComentario(l: LinhaDoComentario): ComentarioDeTarefa {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId: l.tarefa_id,
    autor: autorDaLinha(l.autor_pessoa_id, l.autor_agente_id),
    tipo: l.tipo,
    texto: l.texto,
    // Comentário apagado não diz mais quem foi mencionado.
    mencoes: l.apagado_em
      ? []
      : l.mencoes.map((m) =>
          m.pessoa_id
            ? { tipo: "pessoa" as const, pessoaId: m.pessoa_id }
            : { tipo: "agente" as const, agenteId: m.agente_id as string },
        ),
    criadoEm: l.criado_em.toISOString(),
    editadoEm: iso(l.editado_em),
    apagadoEm: iso(l.apagado_em),
  };
}

/**
 * Os comentários da tarefa, do mais antigo para o mais novo. Nota interna (M3-05) só vai para pessoas: o agente
 * (incluirInternas falso) não recebe.
 */
export async function listarComentarios(
  c: pg.PoolClient,
  tarefaId: string,
  incluirInternas = true,
): Promise<ComentarioDeTarefa[]> {
  const r = await c.query<LinhaDoComentario>(
    `select ${COLUNAS_DO_COMENTARIO} from comentarios_de_tarefa cm
      where cm.tarefa_id = $1 and cm.empresa_id = empresa_ativa() and ($2 or cm.tipo = 'comentario')
      order by cm.criado_em, cm.id`,
    [tarefaId, incluirInternas],
  );
  return r.rows.map(paraComentario);
}

/** Um comentário da tarefa, travado para mudar. */
export async function buscarComentario(
  c: pg.PoolClient,
  tarefaId: string,
  id: string,
): Promise<ComentarioDeTarefa | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.query<LinhaDoComentario>(
    `select ${COLUNAS_DO_COMENTARIO} from comentarios_de_tarefa cm
      where cm.id = $1 and cm.tarefa_id = $2 and cm.empresa_id = empresa_ativa() for update of cm`,
    [id, tarefaId],
  );
  return r.rows[0] ? paraComentario(r.rows[0]) : null;
}

/**
 * Edita o texto (quem escreveu, dentro do prazo, conferido na rota). A menção que saiu do texto (o "@Nome" não está
 * mais lá) deixa de valer: o agente não vê mais a tarefa por ela.
 */
export async function editarComentario(
  c: pg.PoolClient,
  id: string,
  texto: string,
): Promise<ComentarioDeTarefa> {
  await c.query(
    `delete from mencoes_de_comentario m where m.comentario_id = $1 and m.empresa_id = empresa_ativa()
        and strpos($2, '@' || coalesce((select p.nome from pessoas p where p.id = m.pessoa_id),
                                       (select a.nome from agentes a where a.id = m.agente_id))) = 0`,
    [id, texto.trim()],
  );
  const r = await c.query<LinhaDoComentario>(
    `update comentarios_de_tarefa cm set texto = $2, editado_em = now()
      where cm.id = $1 and cm.empresa_id = empresa_ativa() returning ${COLUNAS_DO_COMENTARIO}`,
    [id, texto.trim()],
  );
  return paraComentario(r.rows[0] as LinhaDoComentario);
}

/** Apaga: o texto sai e o lugar fica ("comentário apagado"). */
export async function apagarComentario(c: pg.PoolClient, id: string): Promise<ComentarioDeTarefa> {
  // Os anexos do comentário saem junto (o gatilho deixa os arquivos para a fila apagar do depósito, M3-08).
  await c.query("delete from anexos where comentario_id = $1 and empresa_id = empresa_ativa()", [id]);
  const r = await c.query<LinhaDoComentario>(
    `update comentarios_de_tarefa cm set texto = null, apagado_em = now()
      where cm.id = $1 and cm.empresa_id = empresa_ativa() returning ${COLUNAS_DO_COMENTARIO}`,
    [id],
  );
  return paraComentario(r.rows[0] as LinhaDoComentario);
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
  dados: {
    titulo: string;
    descricao: string | null;
    responsavel: Responsavel | null;
    projetoId?: string | null;
    /** Lista do projeto; sem ela, o banco põe na primeira. */
    listaId?: string | null;
    /** Subtarefa desta tarefa: o banco põe no projeto e na lista dela. */
    tarefaMaeId?: string | null;
  },
): Promise<Tarefa> {
  const [respPessoa, respAgente] = colunas(dados.responsavel);
  const [porPessoa, porAgente] = colunas(autorDe(quem));
  const r = await c.query<LinhaDaTarefa>(
    `insert into tarefas as t (empresa_id, titulo, descricao, responsavel_pessoa_id, responsavel_agente_id,
                            criada_por_pessoa_id, criada_por_agente_id, projeto_id, lista_id, tarefa_mae_id)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUNAS}`,
    [
      dados.titulo.trim(),
      dados.descricao?.trim() || null,
      respPessoa,
      respAgente,
      porPessoa,
      porAgente,
      dados.projetoId ?? null,
      dados.listaId ?? null,
      dados.tarefaMaeId ?? null,
    ],
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
  /** Status do projeto (M3-02), do mesmo tipo. Sem ele, o banco escolhe o primeiro do tipo. */
  statusDoProjetoId: string | null = null,
): Promise<Tarefa> {
  exigirQuemPegou(tarefa, quem);
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
        status_do_projeto_id = coalesce($8, case when t.status = $2 then t.status_do_projeto_id end),
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
      statusDoProjetoId,
    ],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/**
 * Troca o responsável. Se quem pegou passa a tarefa para outro, a trava sai junto (a tarefa fica livre para o
 * novo responsável pegar), senão ninguém mais conseguiria mexer nela.
 */
export async function trocarResponsavel(
  c: pg.PoolClient,
  quem: Quem,
  tarefa: Tarefa,
  responsavel: Responsavel | null,
): Promise<Tarefa> {
  exigirQuemPegou(tarefa, quem);
  const [pessoa, agente] = colunas(responsavel);
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set responsavel_pessoa_id = $2, responsavel_agente_id = $3, atualizada_em = now(),
            travada_por_pessoa_id = null, travada_por_agente_id = null, travada_em = null
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [tarefa.id, pessoa, agente],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/**
 * Acrescenta um comentário ou nota interna (de quem pede ou do sistema), com as menções, e marca a tarefa como
 * atualizada.
 */
export async function comentar(
  c: pg.PoolClient,
  autor: Autor,
  tarefaId: string,
  texto: string,
  opcoes: { tipo?: TipoDeComentario; mencoes?: Responsavel[] } = {},
): Promise<ComentarioDeTarefa> {
  const [pessoa, agente] = colunas(autor);
  const r = await c.query<{ id: string }>(
    `insert into comentarios_de_tarefa (empresa_id, tarefa_id, autor_pessoa_id, autor_agente_id, texto, tipo)
     values (empresa_ativa(), $1, $2, $3, $4, $5) returning id`,
    [tarefaId, pessoa, agente, texto.trim(), opcoes.tipo ?? "comentario"],
  );
  const id = (r.rows[0] as { id: string }).id;
  // Cada pessoa ou agente uma vez só por comentário.
  const vistas = new Set<string>();
  const mencoes = (opcoes.mencoes ?? []).filter((m) => {
    const k = m.tipo === "pessoa" ? `p:${m.pessoaId}` : `a:${m.agenteId}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  if (mencoes.length > 0) {
    await c.query(
      `insert into mencoes_de_comentario (empresa_id, comentario_id, tarefa_id, pessoa_id, agente_id)
       select empresa_ativa(), $1, $2, m.pessoa_id, m.agente_id
         from json_to_recordset($3::json) as m(pessoa_id uuid, agente_id uuid)`,
      [
        id,
        tarefaId,
        JSON.stringify(
          mencoes.map((m) =>
            m.tipo === "pessoa"
              ? { pessoa_id: m.pessoaId, agente_id: null }
              : { pessoa_id: null, agente_id: m.agenteId },
          ),
        ),
      ],
    );
  }
  await c.query("update tarefas set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    tarefaId,
  ]);
  return (await buscarComentario(c, tarefaId, id)) as ComentarioDeTarefa;
}

/** Muda a tarefa de projeto, ou tira do projeto (nulo). Trava, responsável e status ficam como estão. */
export async function mudarProjetoDaTarefa(
  c: pg.PoolClient,
  tarefaId: string,
  projetoId: string | null,
): Promise<Tarefa> {
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set projeto_id = $2, atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [tarefaId, projetoId],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/** Muda a tarefa de lista, no mesmo projeto. As subtarefas vão junto (gatilho do banco). */
export async function mudarListaDaTarefa(
  c: pg.PoolClient,
  tarefaId: string,
  listaId: string,
): Promise<Tarefa> {
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set lista_id = $2, atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [tarefaId, listaId],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}

/** Alguma subtarefa da tarefa está pegada por outro (então a mãe não se exclui). */
export async function subtarefaTravadaPorOutro(
  c: pg.PoolClient,
  tarefaId: string,
  quem: Quem,
): Promise<boolean> {
  const [pessoa, agente] = colunas(autorDe(quem));
  const r = await c.query(
    `select 1 from tarefas where tarefa_mae_id = $1 and empresa_id = empresa_ativa() and travada_em is not null
        and not (coalesce(travada_por_pessoa_id = $2::uuid, false) or coalesce(travada_por_agente_id = $3::uuid, false))
      limit 1`,
    [tarefaId, pessoa, agente],
  );
  return (r.rowCount ?? 0) > 0;
}

/** As subtarefas de uma tarefa, na ordem em que foram criadas. */
export async function listarSubtarefas(c: pg.PoolClient, tarefaMaeId: string): Promise<Tarefa[]> {
  const r = await c.query<LinhaDaTarefa>(
    `select ${COLUNAS} from tarefas t where t.tarefa_mae_id = $1 and t.empresa_id = empresa_ativa()
      order by t.criada_em, t.id`,
    [tarefaMaeId],
  );
  return r.rows.map(linhaParaTarefa);
}

/** Quantas subtarefas (que quem pede alcança) cada tarefa tem e quantas estão prontas. */
export async function resumoDasSubtarefas(
  c: pg.PoolClient,
  quem: Quem,
  ids: string[],
): Promise<Record<string, { total: number; prontas: number }>> {
  if (ids.length === 0) return {};
  const alcance = condicaoDeAlcance(quem, 1);
  const r = await c.query<{ tarefa_mae_id: string; total: number; prontas: number }>(
    `select t.tarefa_mae_id, count(*)::int as total,
            count(*) filter (where t.status in ('concluida', 'cancelada'))::int as prontas
       from tarefas t where t.empresa_id = empresa_ativa() and t.tarefa_mae_id = any($1::uuid[]) and ${alcance.sql}
      group by t.tarefa_mae_id`,
    [ids, ...alcance.valores],
  );
  return Object.fromEntries(r.rows.map((l) => [l.tarefa_mae_id, { total: l.total, prontas: l.prontas }]));
}

export async function excluirTarefa(c: pg.PoolClient, tarefaId: string): Promise<void> {
  await c.query("delete from tarefas where id = $1 and empresa_id = empresa_ativa()", [tarefaId]);
}

/** Nomes de quem aparece nas tarefas e comentários (pessoas e agentes). */
export async function nomesCitados(c: pg.PoolClient, ids: Iterable<string>): Promise<Record<string, string>> {
  const lista = [...new Set(ids)];
  if (lista.length === 0) return {};
  // Pessoas e agentes têm ids diferentes (UUID): um mapa só serve para os dois.
  const r = await c.query<{ id: string; nome: string }>(
    `select id, nome from pessoas where id = any($1::uuid[])
     union all select id, nome from agentes where id = any($1::uuid[]) and empresa_id = empresa_ativa()`,
    [lista],
  );
  return Object.fromEntries(r.rows.map((l) => [l.id, l.nome]));
}

/** Os ids de pessoas e agentes que aparecem nas tarefas e nos comentários. */
export function idsCitados(tarefas: Tarefa[], comentarios: ComentarioDeTarefa[] = []): string[] {
  const ids: string[] = [];
  const somar = (a: Autor | Responsavel | null) => {
    if (a?.tipo === "pessoa") ids.push(a.pessoaId);
    if (a?.tipo === "agente") ids.push(a.agenteId);
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

/** Tentativa de mexer numa tarefa travada por outro (segunda barreira, além da conferência das rotas). */
export class ErroDeTrava extends Error {
  override name = "ErroDeTrava";
}

/** Só quem pegou mexe na tarefa travada. Sem trava, qualquer um que a alcança. */
export function exigirQuemPegou(tarefa: Tarefa, quem: Quem): void {
  if (tarefa.trava && !travadaPorQuem(tarefa, quem)) {
    throw new ErroDeTrava("Tarefa travada por outro responsável");
  }
}

/** Quem pede é quem travou a tarefa (pessoa ou agente). */
export function travadaPorQuem(tarefa: Tarefa, quem: Quem): boolean {
  const por = tarefa.trava?.por;
  if (!por) return false;
  return quem.tipo === "pessoa"
    ? por.tipo === "pessoa" && por.pessoaId === quem.pessoaId
    : por.tipo === "agente" && por.agenteId === quem.agenteId;
}

/**
 * Pegar a tarefa (M2-02): muda para Em andamento, trava para quem pegou e o torna responsável.
 * A condição "ainda sem trava e aberta" está no próprio UPDATE: com dois pedidos ao mesmo tempo, o banco faz o
 * segundo esperar o primeiro e, ao conferir de novo, não acha mais a tarefa livre. Só um consegue.
 */
export async function pegarTarefa(c: pg.PoolClient, quem: Quem, tarefaId: string): Promise<Tarefa | null> {
  const [pessoa, agente] = colunas(autorDe(quem));
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set status = 'em_andamento', travada_por_pessoa_id = $2, travada_por_agente_id = $3,
            travada_em = now(), responsavel_pessoa_id = $2, responsavel_agente_id = $3, atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() and t.travada_em is null
        and t.status not in ('concluida', 'cancelada')
      returning ${COLUNAS}`,
    [tarefaId, pessoa, agente],
  );
  const linha = r.rows[0];
  return linha ? linhaParaTarefa(linha) : null;
}

/** Soltar (quem pegou) ou destravar (administrador): volta para A fazer, sem trava e sem resultado. */
/** Solta a tarefa (volta para "a fazer"; com manterStatus, o status fica, como no "precisa de ajuda" da M4-08). */
export async function tirarTrava(
  c: pg.PoolClient,
  tarefaId: string,
  opcoes: { manterStatus?: boolean } = {},
): Promise<Tarefa> {
  const r = await c.query<LinhaDaTarefa>(
    `update tarefas t set status = case when $2 then t.status else 'a_fazer' end, travada_por_pessoa_id = null,
            travada_por_agente_id = null, travada_em = null, atualizada_em = now()
      where t.id = $1 and t.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [tarefaId, opcoes.manterStatus ?? false],
  );
  return linhaParaTarefa(r.rows[0] as LinhaDaTarefa);
}
