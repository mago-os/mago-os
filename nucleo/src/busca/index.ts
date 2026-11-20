/**
 * Busca Ctrl+K (M3-09): tarefas, comentários, projetos, espaços, pessoas e agentes, sem acento e tolerante a erro de
 * digitação (pg_trgm), sempre com a permissão de quem busca. Cada tipo só entra para quem pode vê-lo, com a mesma
 * regra das listas. Buscar não entra na auditoria (é só leitura).
 */
import {
  conferir,
  PedidoDeBusca,
  RESULTADOS_POR_TIPO,
  type ResultadoDaBusca,
  TIPOS_DE_RESULTADO,
  type TipoDeResultado,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { comPessoa } from "../empresa.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { condicaoDeAlcance, type Quem } from "../tarefas/servico.ts";

/** Quanto parecido (0 a 1) a palavra precisa ser para valer: "bakup" acha "backup". */
const PARECIDO = 0.4;

/** Minúsculas e sem acento, como a função para_busca do banco. */
export function paraBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Um pedaço do texto em volta do que foi achado (ou o começo, quando o achado foi por semelhança). */
export function trecho(texto: string, busca: string, tamanho = 140): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const onde = paraBusca(limpo).indexOf(paraBusca(busca));
  if (limpo.length <= tamanho) return limpo;
  const inicio = Math.max(0, Math.max(onde, 0) - Math.floor(tamanho / 3));
  const pedaco = limpo.slice(inicio, inicio + tamanho);
  return `${inicio > 0 ? "..." : ""}${pedaco}${inicio + tamanho < limpo.length ? "..." : ""}`;
}

export interface OndeBuscar {
  /** Quem busca, com o alcance de ver tarefas (nulo: não vê tarefas). */
  tarefas: Extract<Quem, { tipo: "pessoa" }> | null;
  projetos: "todos" | "membro" | null;
  espacos: boolean;
  /** Filtro das pessoas (o mesmo da tela Pessoas), ou nulo. */
  pessoas: { tipo: "tudo" } | { tipo: "equipe"; area: string | null } | { tipo: "meus" } | null;
  agentes: boolean;
}

/** Busca na empresa ativa. Cada tipo só entra se "onde" deixa. */
export async function buscar(
  c: pg.PoolClient,
  pessoaId: string,
  texto: string,
  onde: OndeBuscar,
  tipos: readonly TipoDeResultado[] = TIPOS_DE_RESULTADO,
): Promise<ResultadoDaBusca[]> {
  const q = paraBusca(texto.trim());
  if (q.length < 2) return [];
  await c.query(`select set_config('pg_trgm.word_similarity_threshold', '${PARECIDO}', true)`);
  // $1 é sempre o texto; "acha" diz se o campo tem o texto ou uma palavra parecida.
  const acha = (campo: string) =>
    `(para_busca(${campo}) like '%' || $1 || '%' or $1 <% para_busca(${campo}))`;
  const nota = (campo: string) => `word_similarity($1, para_busca(${campo}))`;
  const quer = (t: TipoDeResultado) => tipos.includes(t);
  const resultados: ResultadoDaBusca[] = [];

  if (onde.tarefas && quer("tarefa")) {
    const alcance = condicaoDeAlcance(onde.tarefas, 1);
    const r = await c.query<{ id: string; titulo: string; descricao: string | null }>(
      `select t.id, t.titulo, t.descricao from tarefas t
        where t.empresa_id = empresa_ativa() and ${alcance.sql}
          and (${acha("t.titulo")} or para_busca(coalesce(t.descricao, '')) like '%' || $1 || '%')
        order by greatest(${nota("t.titulo")}, case when para_busca(t.titulo) like '%' || $1 || '%' then 1 else 0 end) desc,
                 t.atualizada_em desc
        limit ${RESULTADOS_POR_TIPO}`,
      [q, ...alcance.valores],
    );
    for (const t of r.rows) {
      const naDescricao =
        t.descricao && !paraBusca(t.titulo).includes(q) && paraBusca(t.descricao).includes(q);
      resultados.push({
        tipo: "tarefa",
        id: t.id,
        titulo: t.titulo,
        trecho: naDescricao && t.descricao ? trecho(t.descricao, texto) : null,
        link: `/tarefas/${t.id}`,
      });
    }
  }

  if (onde.tarefas && quer("comentario")) {
    const alcance = condicaoDeAlcance(onde.tarefas, 1);
    const r = await c.query<{ id: string; tarefa_id: string; titulo: string; texto: string }>(
      `select cm.id, t.id as tarefa_id, t.titulo, cm.texto
         from comentarios_de_tarefa cm join tarefas t on t.id = cm.tarefa_id and t.empresa_id = cm.empresa_id
        where cm.empresa_id = empresa_ativa() and cm.apagado_em is null and ${alcance.sql} and ${acha("cm.texto")}
        order by ${nota("cm.texto")} desc, cm.criado_em desc
        limit ${RESULTADOS_POR_TIPO}`,
      [q, ...alcance.valores],
    );
    for (const cm of r.rows) {
      resultados.push({
        tipo: "comentario",
        id: cm.id,
        titulo: cm.titulo,
        trecho: trecho(cm.texto, texto),
        link: `/tarefas/${cm.tarefa_id}`,
      });
    }
  }

  if (onde.projetos && quer("projeto")) {
    const condicao =
      onde.projetos === "todos" ? "($2::uuid is not null or true)" : "membro_do_projeto(p.id, $2)";
    const r = await c.query<{ id: string; nome: string }>(
      `select p.id, p.nome from projetos p
        where p.empresa_id = empresa_ativa() and p.situacao = 'ativo' and ${condicao} and ${acha("p.nome")}
        order by ${nota("p.nome")} desc, lower(p.nome) limit ${RESULTADOS_POR_TIPO}`,
      [q, pessoaId],
    );
    for (const p of r.rows)
      resultados.push({ tipo: "projeto", id: p.id, titulo: p.nome, trecho: null, link: `/projetos/${p.id}` });
  }

  if (onde.espacos && quer("espaco")) {
    const r = await c.query<{ id: string; nome: string }>(
      `select e.id, e.nome from espacos e
        where e.empresa_id = empresa_ativa() and e.situacao = 'ativo' and ${acha("e.nome")}
        order by ${nota("e.nome")} desc, lower(e.nome) limit ${RESULTADOS_POR_TIPO}`,
      [q],
    );
    for (const e of r.rows)
      resultados.push({
        tipo: "espaco",
        id: e.id,
        titulo: e.nome,
        trecho: null,
        link: `/projetos#espaco-${e.id}`,
      });
  }

  if (onde.pessoas && quer("pessoa")) {
    const f = onde.pessoas;
    const condicao =
      f.tipo === "tudo"
        ? "($2::uuid is not null or true)"
        : f.tipo === "equipe"
          ? "(v.area = $3 or p.id = $2)"
          : "p.id = $2";
    const r = await c.query<{ id: string; nome: string; area: string | null }>(
      `select p.id, p.nome, v.area from vinculos v join pessoas p on p.id = v.pessoa_id
        where v.empresa_id = empresa_ativa() and v.situacao = 'ativo' and ${condicao} and ${acha("p.nome")}
        order by ${nota("p.nome")} desc, p.nome limit ${RESULTADOS_POR_TIPO}`,
      f.tipo === "equipe" ? [q, pessoaId, f.area] : [q, pessoaId],
    );
    // Só o nome e a área: o e-mail nunca aparece na busca.
    for (const p of r.rows)
      resultados.push({ tipo: "pessoa", id: p.id, titulo: p.nome, trecho: p.area, link: "/pessoas" });
  }

  if (onde.agentes && quer("agente")) {
    const r = await c.query<{ id: string; nome: string }>(
      `select g.id, g.nome from agentes g
        where g.empresa_id = empresa_ativa() and g.situacao <> 'desligado' and ${acha("g.nome")}
        order by ${nota("g.nome")} desc, g.nome limit ${RESULTADOS_POR_TIPO}`,
      [q],
    );
    for (const g of r.rows)
      resultados.push({ tipo: "agente", id: g.id, titulo: g.nome, trecho: null, link: `/agentes/${g.id}` });
  }
  return resultados;
}

/** Onde quem pede pode buscar, pela permissão de cada módulo. */
export function ondeBuscar(pedido: FastifyRequest): OndeBuscar {
  const { sessao, permissoes } = acessoDo(pedido);
  const ver = (modulo: string) => permissoes.modulos.get(modulo)?.acoes.ver ?? "nada";
  const filtroTarefas = filtroDoAlcance(ver("tarefas"), sessao.pessoa.id, permissoes.area);
  const projetos = ver("projetos");
  const pessoas = filtroDoAlcance(ver("pessoas"), sessao.pessoa.id, permissoes.area);
  return {
    tarefas: filtroTarefas
      ? {
          tipo: "pessoa",
          pessoaId: sessao.pessoa.id,
          filtro: filtroTarefas,
          projetos: projetos === "nada" ? "nenhum" : projetos === "tudo" ? "todos" : "membro",
        }
      : null,
    projetos: projetos === "nada" ? null : projetos === "tudo" ? "todos" : "membro",
    espacos: ver("espacos") !== "nada",
    pessoas: pessoas
      ? pessoas.tipo === "tudo"
        ? { tipo: "tudo" }
        : pessoas.tipo === "equipe"
          ? { tipo: "equipe", area: pessoas.area }
          : { tipo: "meus" }
      : null,
    agentes: ver("agentes") !== "nada",
  };
}

export function registrarRotaDaBusca(app: FastifyInstance, verificador: Verificador, poolApp: pg.Pool): void {
  app.get("/busca", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const q = pedido.query as { texto?: string; tipos?: string };
    const r = conferir(PedidoDeBusca, {
      texto: q.texto ?? "",
      ...(q.tipos ? { tipos: q.tipos.split(",") } : {}),
    });
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const { sessao } = acessoDo(pedido);
    const onde = ondeBuscar(pedido);
    const resultados = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
      buscar(c, sessao.pessoa.id, r.valor.texto, onde, r.valor.tipos ?? TIPOS_DE_RESULTADO),
    );
    return { resultados };
  });
}
