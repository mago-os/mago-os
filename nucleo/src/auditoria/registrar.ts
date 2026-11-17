/**
 * Gravação de eventos de auditoria (M1-09), no formato do contrato (contratos/src/auditoria.ts).
 *
 * Numa transação: reserva a ponta da corrente (o banco trava até o fim), monta o evento, calcula a impressão
 * digital pelo contrato e grava. Dois eventos ao mesmo tempo na mesma corrente entram um depois do outro.
 * Ver docs/decisoes/0014-auditoria.md.
 */
import { randomUUID } from "node:crypto";
import { type Ator, calcularHash, conferirEventoAuditoria, type EventoAuditoria } from "@mago-os/contratos";
import type pg from "pg";

export interface DadosDoEvento {
  /** Empresa do evento; nula para eventos da plataforma (ex.: senha errada num e-mail qualquer). */
  empresaId: string | null;
  ator: Ator;
  acao: string;
  alvo?: { tipo: string; id: string } | null;
  origem: {
    canal: "painel" | "api" | "telegram" | "mcp" | "sistema";
    ip: string | null;
    aparelho: string | null;
  };
  rastreio?: string | null;
  detalhes?: Record<string, unknown>;
}

export class ErroDeAuditoria extends Error {
  override name = "ErroDeAuditoria";
}

/** Grava um evento e devolve como ficou (com posição e impressão digital). */
export async function registrarEvento(pool: pg.Pool, dados: DadosDoEvento): Promise<EventoAuditoria> {
  const conexao = await pool.connect();
  try {
    await conexao.query("begin");
    const ponta = await conexao.query<{ sequencia: string; hash_anterior: string | null }>(
      "select sequencia, hash_anterior from auditoria.reservar($1)",
      [dados.empresaId],
    );
    const { sequencia, hash_anterior } = ponta.rows[0] as { sequencia: string; hash_anterior: string | null };
    const semHash: Omit<EventoAuditoria, "hash"> = {
      id: randomUUID(),
      empresaId: dados.empresaId,
      sequencia: Number(sequencia),
      ator: dados.ator,
      acao: dados.acao,
      alvo: dados.alvo ?? null,
      origem: dados.origem,
      ocorridoEm: new Date().toISOString(),
      // Só o número de rastreio no formato do OpenTelemetry (32 hexadecimais); outro formato não barra o evento.
      rastreio: dados.rastreio && /^[0-9a-f]{32}$/.test(dados.rastreio) ? dados.rastreio : null,
      detalhes: dados.detalhes ?? {},
      hashAnterior: hash_anterior,
    };
    const evento: EventoAuditoria = { ...semHash, hash: await calcularHash(semHash) };
    const conferido = conferirEventoAuditoria(evento);
    if (!conferido.ok) {
      throw new ErroDeAuditoria(
        `Evento fora do contrato: ${conferido.problemas.map((p) => `${p.caminho} ${p.mensagem}`).join("; ")}`,
      );
    }
    await conexao.query("select auditoria.gravar($1::jsonb)", [JSON.stringify(evento)]);
    await conexao.query("commit");
    return evento;
  } catch (erro) {
    await conexao.query("rollback").catch(() => {});
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Lê uma corrente inteira do banco no formato do contrato (para a verificação). Só com o papel dono. */
export async function lerCorrente(cliente: pg.ClientBase, corrente: string): Promise<EventoAuditoria[]> {
  const r = await cliente.query(
    `select id, empresa_id, sequencia, ator, acao, alvo, origem, ocorrido_em, rastreio, detalhes, hash_anterior, hash
       from auditoria.eventos where corrente = $1 order by sequencia`,
    [corrente],
  );
  return r.rows.map(linhaParaEvento);
}

export function linhaParaEvento(l: Record<string, unknown>): EventoAuditoria {
  return {
    id: String(l.id),
    empresaId: (l.empresa_id as string | null) ?? null,
    sequencia: Number(l.sequencia),
    ator: l.ator as Ator,
    acao: String(l.acao),
    alvo: (l.alvo as EventoAuditoria["alvo"]) ?? null,
    origem: l.origem as EventoAuditoria["origem"],
    // O banco devolve a data como Date; o contrato guarda o texto ISO com que o hash foi calculado.
    ocorridoEm: (l.ocorrido_em instanceof Date
      ? l.ocorrido_em
      : new Date(String(l.ocorrido_em))
    ).toISOString(),
    rastreio: (l.rastreio as string | null) ?? null,
    detalhes: (l.detalhes as Record<string, unknown>) ?? {},
    hashAnterior: (l.hash_anterior as string | null) ?? null,
    hash: String(l.hash),
  };
}

/**
 * Grava o evento sem derrubar o pedido se a auditoria falhar (o login continua funcionando); a falha vai para
 * o log como erro, e a verificação diária mostra a corrente como ela ficou.
 */
export async function auditar(
  pool: pg.Pool,
  dados: DadosDoEvento,
  log?: { error(obj: unknown, msg?: string): void },
): Promise<void> {
  try {
    await registrarEvento(pool, dados);
  } catch (erro) {
    log?.error({ erro, acao: dados.acao }, "Auditoria: não foi possível gravar o evento");
  }
}
