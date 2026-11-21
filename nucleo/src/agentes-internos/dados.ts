/**
 * Conversas, mensagens e execuções dos agentes internos (M4-02). Cada função roda na transação de quem chamou: com a
 * pessoa (comPessoa), o banco só mostra as conversas dela; no motor (comEmpresa), todas as da empresa.
 */
import type {
  AutorDaMensagem,
  Conversa,
  ExecucaoDeAgente,
  MensagemDeConversa,
  OrigemDaExecucao,
  SituacaoDaExecucao,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";

interface LinhaDaConversa {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  agente_id: string;
  titulo: string;
  criada_em: Date;
  atualizada_em: Date;
}

const paraConversa = (l: LinhaDaConversa): Conversa => ({
  id: l.id,
  empresaId: l.empresa_id,
  pessoaId: l.pessoa_id,
  agenteId: l.agente_id,
  titulo: l.titulo,
  criadaEm: l.criada_em.toISOString(),
  atualizadaEm: l.atualizada_em.toISOString(),
});

export async function listarConversas(c: pg.PoolClient, pessoaId: string): Promise<Conversa[]> {
  const r = await c.query<LinhaDaConversa>(
    `select * from conversas where empresa_id = empresa_ativa() and pessoa_id = $1
      order by atualizada_em desc limit 50`,
    [pessoaId],
  );
  return r.rows.map(paraConversa);
}

export async function buscarConversa(c: pg.PoolClient, id: string): Promise<Conversa | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDaConversa>(
    "select * from conversas where id = $1 and empresa_id = empresa_ativa()",
    [id],
  );
  return r.rows[0] ? paraConversa(r.rows[0]) : null;
}

export async function criarConversa(
  c: pg.PoolClient,
  pessoaId: string,
  agenteId: string,
  titulo: string,
): Promise<Conversa> {
  const curto = titulo.replace(/\s+/g, " ").trim();
  const r = await c.query<LinhaDaConversa>(
    `insert into conversas (empresa_id, pessoa_id, agente_id, titulo) values (empresa_ativa(), $1, $2, $3)
     returning *`,
    [pessoaId, agenteId, curto.length > 120 ? `${curto.slice(0, 117)}...` : curto],
  );
  return paraConversa(r.rows[0] as LinhaDaConversa);
}

export async function apagarConversa(c: pg.PoolClient, id: string): Promise<boolean> {
  const r = await c.query("delete from conversas where id = $1 and empresa_id = empresa_ativa()", [id]);
  return (r.rowCount ?? 0) > 0;
}

interface LinhaDaMensagem {
  id: string;
  conversa_id: string;
  autor_pessoa_id: string | null;
  autor_agente_id: string | null;
  texto: string;
  execucao_id: string | null;
  tarefas: string[];
  criada_em: Date;
}

const paraMensagem = (l: LinhaDaMensagem): MensagemDeConversa => ({
  id: l.id,
  conversaId: l.conversa_id,
  autor: l.autor_pessoa_id
    ? { tipo: "pessoa", pessoaId: l.autor_pessoa_id }
    : l.autor_agente_id
      ? { tipo: "agente", agenteId: l.autor_agente_id }
      : { tipo: "sistema" },
  texto: l.texto,
  execucaoId: l.execucao_id,
  tarefas: l.tarefas,
  criadaEm: l.criada_em.toISOString(),
});

export async function listarMensagens(
  c: pg.PoolClient,
  conversaId: string,
  ultimas = 200,
): Promise<MensagemDeConversa[]> {
  const r = await c.query<LinhaDaMensagem>(
    `select * from (select * from mensagens_de_conversa where conversa_id = $1 and empresa_id = empresa_ativa()
        order by criada_em desc limit $2) m order by criada_em`,
    [conversaId, ultimas],
  );
  return r.rows.map(paraMensagem);
}

export async function gravarMensagem(
  c: pg.PoolClient,
  conversa: Conversa,
  autor: AutorDaMensagem,
  texto: string,
  extras: { execucaoId?: string | null; tarefas?: string[] } = {},
): Promise<MensagemDeConversa> {
  const limpo = texto.trim().slice(0, 8000) || "(sem texto)";
  const r = await c.query<LinhaDaMensagem>(
    `insert into mensagens_de_conversa (empresa_id, conversa_id, pessoa_id, autor_pessoa_id, autor_agente_id, texto,
       execucao_id, tarefas)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7) returning *`,
    [
      conversa.id,
      conversa.pessoaId,
      autor.tipo === "pessoa" ? autor.pessoaId : null,
      autor.tipo === "agente" ? autor.agenteId : null,
      limpo,
      extras.execucaoId ?? null,
      (extras.tarefas ?? []).slice(0, 20),
    ],
  );
  await c.query("update conversas set atualizada_em = now() where id = $1 and empresa_id = empresa_ativa()", [
    conversa.id,
  ]);
  return paraMensagem(r.rows[0] as LinhaDaMensagem);
}

interface LinhaDaExecucao {
  id: string;
  empresa_id: string;
  agente_id: string;
  pedido_por: string;
  origem: OrigemDaExecucao;
  conversa_id: string | null;
  tarefa_id: string | null;
  execucao_mae_id: string | null;
  instrucoes: string | null;
  situacao: SituacaoDaExecucao;
  modelo_conta_id: string | null;
  modelo: string | null;
  passou_ao_reserva_porque: string | null;
  leu_texto_de_outros: boolean;
  resumo: string | null;
  criada_em: Date;
  iniciada_em: Date | null;
  terminada_em: Date | null;
}

export type ExecucaoComInstrucoes = ExecucaoDeAgente & { instrucoes: string | null };

const paraExecucao = (l: LinhaDaExecucao): ExecucaoComInstrucoes => ({
  id: l.id,
  empresaId: l.empresa_id,
  agenteId: l.agente_id,
  pedidoPor: l.pedido_por,
  origem: l.origem,
  conversaId: l.conversa_id,
  tarefaId: l.tarefa_id,
  execucaoMaeId: l.execucao_mae_id,
  situacao: l.situacao,
  leuTextoDeOutros: l.leu_texto_de_outros,
  modeloUsado: l.modelo_conta_id && l.modelo ? { contaId: l.modelo_conta_id, modelo: l.modelo } : null,
  passouAoReservaPorque: l.passou_ao_reserva_porque,
  resumo: l.resumo,
  criadaEm: l.criada_em.toISOString(),
  iniciadaEm: l.iniciada_em?.toISOString() ?? null,
  terminadaEm: l.terminada_em?.toISOString() ?? null,
  instrucoes: l.instrucoes,
});

export async function criarExecucao(
  c: pg.PoolClient,
  d: {
    agenteId: string;
    pedidoPor: string;
    origem: OrigemDaExecucao;
    conversaId?: string | null;
    tarefaId?: string | null;
    execucaoMaeId?: string | null;
    instrucoes?: string | null;
    /** A delegação herda a marca de texto de outros (M4-04). */
    leuTextoDeOutros?: boolean;
  },
): Promise<ExecucaoComInstrucoes> {
  const r = await c.query<LinhaDaExecucao>(
    `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, conversa_id, tarefa_id,
       execucao_mae_id, instrucoes, leu_texto_de_outros)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [
      d.agenteId,
      d.pedidoPor,
      d.origem,
      d.conversaId ?? null,
      d.tarefaId ?? null,
      d.execucaoMaeId ?? null,
      d.instrucoes?.trim().slice(0, 4000) || null,
      d.leuTextoDeOutros ?? false,
    ],
  );
  return paraExecucao(r.rows[0] as LinhaDaExecucao);
}

export async function buscarExecucao(
  c: pg.PoolClient,
  id: string,
  paraMudar = false,
): Promise<ExecucaoComInstrucoes | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDaExecucao>(
    `select * from execucoes_de_agente where id = $1 and empresa_id = empresa_ativa() ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraExecucao(r.rows[0]) : null;
}

/** Execuções em andamento de uma conversa (a tela mostra "pensando..."). */
export async function execucoesEmAndamento(c: pg.PoolClient, conversaId: string): Promise<number> {
  const r = await c.query<{ n: number }>(
    `select count(*)::int as n from execucoes_de_agente e
      where e.empresa_id = empresa_ativa() and e.situacao in ('na_fila', 'rodando')
        and (e.conversa_id = $1 or e.execucao_mae_id in
              (select id from execucoes_de_agente where conversa_id = $1 and empresa_id = empresa_ativa()))`,
    [conversaId],
  );
  return r.rows[0]?.n ?? 0;
}

export async function iniciarExecucao(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update execucoes_de_agente set situacao = 'rodando', iniciada_em = now()
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'na_fila'`,
    [id],
  );
}

export async function terminarExecucao(
  c: pg.PoolClient,
  id: string,
  d: {
    situacao: "concluida" | "falhou" | "parada";
    resumo: string | null;
    modelo?: { contaId: string; modelo: string } | null;
    passouAoReservaPorque?: string | null;
  },
): Promise<void> {
  await c.query(
    `update execucoes_de_agente set situacao = $2, resumo = $3, terminada_em = now(),
            iniciada_em = coalesce(iniciada_em, now()),
            modelo_conta_id = coalesce($4, modelo_conta_id), modelo = coalesce($5, modelo),
            passou_ao_reserva_porque = coalesce($6, passou_ao_reserva_porque)
      where id = $1 and empresa_id = empresa_ativa() and situacao in ('na_fila', 'rodando')`,
    [
      id,
      d.situacao,
      d.resumo?.trim().slice(0, 2000) || null,
      d.modelo?.contaId ?? null,
      d.modelo?.modelo ?? null,
      d.passouAoReservaPorque?.slice(0, 300) ?? null,
    ],
  );
}
