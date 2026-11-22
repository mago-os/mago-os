/**
 * Linha do tempo da tarefa (M3-05): os acontecimentos (status, responsável, prazo...) numa tabela da própria tarefa,
 * e as menções que um agente ainda não respondeu. Cada função roda dentro da transação do chamador.
 */
import type { AcontecimentoDaTarefa, Autor, Responsavel, TipoDeAcontecimento } from "@mago-os/contratos";
import type pg from "pg";

/** Da ação de auditoria ao acontecimento da linha do tempo (só as que interessam a quem acompanha a tarefa). */
export function acontecimentoDaAcao(
  acao: string,
  detalhes: Record<string, unknown>,
): { tipo: TipoDeAcontecimento; detalhes: Record<string, unknown> } | null {
  switch (acao) {
    case "tarefa.criou":
      return { tipo: "criou", detalhes: {} };
    case "tarefa.mudou_status":
      return detalhes.para === "concluida" && detalhes.comResultado === true
        ? { tipo: "entregou_resultado", detalhes: { de: detalhes.de ?? null } }
        : { tipo: "mudou_status", detalhes: { de: detalhes.de ?? null, para: detalhes.para ?? null } };
    case "tarefa.trocou_responsavel":
      return { tipo: "trocou_responsavel", detalhes: { para: detalhes.para ?? null } };
    case "tarefa.mudou_prazo":
      return { tipo: "mudou_prazo", detalhes: { dia: detalhes.dia ?? null, hora: detalhes.hora ?? null } };
    case "tarefa.mudou_prioridade":
      return { tipo: "mudou_prioridade", detalhes: { para: detalhes.para ?? null } };
    case "tarefa.mudou_projeto":
      return { tipo: "mudou_projeto", detalhes: { para: detalhes.para ?? null } };
    case "tarefa.mudou_lista":
      return { tipo: "mudou_lista", detalhes: { para: detalhes.para ?? null } };
    case "tarefa.pegou":
      return { tipo: "pegou", detalhes: {} };
    case "tarefa.soltou":
      return { tipo: "soltou", detalhes: {} };
    default:
      return null;
  }
}

/** Grava o acontecimento (na transação da empresa). */
export async function registrarAcontecimento(
  c: pg.PoolClient,
  tarefaId: string,
  autor: Autor,
  tipo: TipoDeAcontecimento,
  detalhes: Record<string, unknown>,
): Promise<void> {
  await c.query(
    `insert into acontecimentos_de_tarefa (empresa_id, tarefa_id, autor_pessoa_id, autor_agente_id, tipo, detalhes)
     select empresa_ativa(), $1, $2, $3, $4, $5::jsonb
      where exists (select 1 from tarefas where id = $1 and empresa_id = empresa_ativa())`,
    [
      tarefaId,
      autor.tipo === "pessoa" ? autor.pessoaId : null,
      autor.tipo === "agente" ? autor.agenteId : null,
      tipo,
      JSON.stringify(detalhes),
    ],
  );
}

export async function listarAcontecimentos(
  c: pg.PoolClient,
  tarefaId: string,
): Promise<AcontecimentoDaTarefa[]> {
  const r = await c.query<{
    id: string;
    empresa_id: string;
    tarefa_id: string;
    autor_pessoa_id: string | null;
    autor_agente_id: string | null;
    tipo: TipoDeAcontecimento;
    detalhes: Record<string, unknown>;
    criado_em: Date;
  }>(
    `select id, empresa_id, tarefa_id, autor_pessoa_id, autor_agente_id, tipo, detalhes, criado_em
       from acontecimentos_de_tarefa where tarefa_id = $1 and empresa_id = empresa_ativa() order by criado_em, id`,
    [tarefaId],
  );
  return r.rows.map((l) => ({
    id: l.id,
    empresaId: l.empresa_id,
    tarefaId: l.tarefa_id,
    autor: l.autor_pessoa_id
      ? { tipo: "pessoa", pessoaId: l.autor_pessoa_id }
      : l.autor_agente_id
        ? { tipo: "agente", agenteId: l.autor_agente_id }
        : { tipo: "sistema" },
    tipo: l.tipo,
    detalhes: l.detalhes,
    criadoEm: l.criado_em.toISOString(),
  }));
}

/** As tarefas em que o agente foi mencionado (em comentário, não nota) e ainda não comentou depois. */
export async function mencoesPendentes(c: pg.PoolClient, agenteId: string): Promise<string[]> {
  const r = await c.query<{ tarefa_id: string }>(
    `select distinct mc.tarefa_id from mencoes_de_comentario mc
       join comentarios_de_tarefa cm on cm.id = mc.comentario_id
       join tarefas t on t.id = mc.tarefa_id and t.empresa_id = mc.empresa_id
      where mc.empresa_id = empresa_ativa() and mc.agente_id = $1 and cm.tipo = 'comentario' and cm.apagado_em is null
        and t.status not in ('concluida', 'cancelada')
        and not exists (select 1 from comentarios_de_tarefa r where r.tarefa_id = mc.tarefa_id
                          and r.empresa_id = mc.empresa_id and r.autor_agente_id = $1 and r.criado_em > cm.criado_em)`,
    [agenteId],
  );
  return r.rows.map((l) => l.tarefa_id);
}

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * As menções escritas no texto ("@Ana", "@Ana Souza", "@Gerente de projetos"), para quem comenta sem a tela que escolhe
 * da lista: os agentes, pelo MCP ou de dentro. Vale o nome inteiro, ou o primeiro nome quando só uma pessoa ou agente
 * ativo da empresa tem esse primeiro nome. Sem diferença de acento ou maiúscula.
 */
export async function mencoesDoTexto(c: pg.PoolClient, texto: string): Promise<Responsavel[]> {
  if (!texto.includes("@")) return [];
  const r = await c.query<{ tipo: "pessoa" | "agente"; id: string; nome: string }>(
    `select 'pessoa' as tipo, p.id, p.nome from vinculos v join pessoas p on p.id = v.pessoa_id
      where v.empresa_id = empresa_ativa() and v.situacao = 'ativo'
     union all
     select 'agente', a.id, a.nome from agentes a where a.empresa_id = empresa_ativa() and a.situacao <> 'desligado'`,
  );
  const normal = semAcento(texto);
  // Depois do @ e do nome vem o fim do texto, um espaço ou uma pontuação (não o meio de outra palavra).
  const mencionou = (nome: string) => {
    const alvo = `@${semAcento(nome.trim())}`;
    let i = normal.indexOf(alvo);
    while (i >= 0) {
      const depois = normal.charAt(i + alvo.length);
      if (!depois || !/[\p{L}\p{N}_]/u.test(depois)) return true;
      i = normal.indexOf(alvo, i + 1);
    }
    return false;
  };
  const primeiro = (nome: string) => semAcento(nome.trim().split(/\s+/)[0] ?? "");
  const contagem = new Map<string, number>();
  for (const x of r.rows) contagem.set(primeiro(x.nome), (contagem.get(primeiro(x.nome)) ?? 0) + 1);
  const mencoes: Responsavel[] = [];
  for (const x of r.rows) {
    const peloPrimeiro =
      contagem.get(primeiro(x.nome)) === 1 && mencionou(x.nome.trim().split(/\s+/)[0] ?? "");
    if (mencionou(x.nome) || peloPrimeiro)
      mencoes.push(
        x.tipo === "pessoa" ? { tipo: "pessoa", pessoaId: x.id } : { tipo: "agente", agenteId: x.id },
      );
  }
  return mencoes.slice(0, 20);
}

/** As pessoas e agentes mencionados existem e estão ativos nesta empresa. */
export async function mencionaveis(c: pg.PoolClient, mencoes: Responsavel[]): Promise<boolean> {
  if (mencoes.length === 0) return true;
  const pessoas = mencoes.flatMap((m) => (m.tipo === "pessoa" ? [m.pessoaId] : []));
  const agentes = mencoes.flatMap((m) => (m.tipo === "agente" ? [m.agenteId] : []));
  const r = await c.query<{ p: number; a: number }>(
    `select (select count(*)::int from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
               and pessoa_id = any($1::uuid[])) as p,
            (select count(*)::int from agentes where empresa_id = empresa_ativa() and situacao <> 'desligado'
               and id = any($2::uuid[])) as a`,
    [pessoas, agentes],
  );
  const l = r.rows[0] as { p: number; a: number };
  return l.p === new Set(pessoas).size && l.a === new Set(agentes).size;
}
