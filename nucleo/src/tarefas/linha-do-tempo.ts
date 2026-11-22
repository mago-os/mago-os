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

/** Sem acento, em minúsculas e sem espaço nas pontas: para comparar nomes. */
export const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const MAXIMO_DE_MENCOES_NO_TEXTO = 20;

/**
 * As pessoas mencionadas no texto ("@Ana", "@Ana Souza"), para quem comenta sem a tela que escolhe da lista: os
 * agentes, pelo MCP ou de dentro. Vale o nome inteiro, ou o primeiro nome quando só uma pessoa ativa da empresa tem
 * esse primeiro nome. No mesmo @ vale o nome mais longo ("@Ana Beatriz" não menciona a "Ana"), e nome que serve para
 * duas pessoas não menciona ninguém. Sem diferença de acento ou maiúscula; o @ no meio de uma palavra (um e-mail) não
 * conta. Só pessoas: mencionar um agente abre a tarefa para ele (M3-05), e isso fica com quem escolhe na tela. Na ordem
 * do texto, até 20.
 */
export async function mencoesDoTexto(c: pg.PoolClient, texto: string): Promise<Responsavel[]> {
  if (!texto.includes("@")) return [];
  const r = await c.query<{ id: string; nome: string }>(
    `select p.id, p.nome from vinculos v join pessoas p on p.id = v.pessoa_id
      where v.empresa_id = empresa_ativa() and v.situacao = 'ativo'`,
  );
  const inteiros = new Map<string, string[]>();
  const primeiros = new Map<string, string[]>();
  const juntar = (m: Map<string, string[]>, chave: string, id: string) => {
    if (chave) m.set(chave, [...(m.get(chave) ?? []), id]);
  };
  for (const p of r.rows) {
    const inteiro = semAcento(p.nome).replace(/\s+/g, " ");
    juntar(inteiros, inteiro, p.id);
    juntar(primeiros, inteiro.split(" ")[0] ?? "", p.id);
  }
  // Do nome mais longo para o mais curto; no mesmo tamanho, o nome inteiro antes do primeiro nome.
  const chaves = [
    ...[...inteiros].map(([chave, ids]) => ({ chave, ids, inteiro: 1 })),
    ...[...primeiros].map(([chave, ids]) => ({ chave, ids, inteiro: 0 })),
  ].sort((a, b) => b.chave.length - a.chave.length || b.inteiro - a.inteiro);
  const letra = /[\p{L}\p{N}_]/u;
  const normal = semAcento(texto).replace(/\s+/g, " ");
  const achados: string[] = [];
  for (let i = normal.indexOf("@"); i >= 0; i = normal.indexOf("@", i + 1)) {
    if (achados.length >= MAXIMO_DE_MENCOES_NO_TEXTO) break;
    // Um e-mail (ana@empresa.com) não é menção.
    if (i > 0 && /[\p{L}\p{N}_.+-]/u.test(normal.charAt(i - 1))) continue;
    const resto = normal.slice(i + 1);
    // Depois do nome vem o fim do texto, um espaço ou uma pontuação (não o meio de outra palavra).
    const achada = chaves.find(
      ({ chave }) => resto.startsWith(chave) && !letra.test(resto.charAt(chave.length)),
    );
    const id = achada?.ids.length === 1 ? achada.ids[0] : undefined;
    if (id && !achados.includes(id)) achados.push(id);
  }
  return achados.map((pessoaId) => ({ tipo: "pessoa", pessoaId }));
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
