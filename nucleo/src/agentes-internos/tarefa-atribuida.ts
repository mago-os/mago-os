/**
 * Tarefa atribuída a um agente interno (M4-04, decisão 0026): vira trabalho dele, numa execução com origem "tarefa".
 * Quem pediu é quem atribuiu (uma pessoa); sem pessoa (recorrência, agente externo, o sistema), é o responsável pelo
 * agente. Um agente interno que atribui passa a pessoa em nome de quem age (e a marca de texto de outros), nunca a si
 * mesmo: assim a tarefa não ganha a permissão do responsável. Agente pausado: a execução espera na fila até ele
 * voltar. Uma execução aberta por tarefa e agente.
 */
import type { Autor } from "@mago-os/contratos";
import type pg from "pg";
import { comEmpresa } from "../empresa.ts";
import { criarExecucao } from "./dados.ts";

export async function entregarAoAgenteInterno(
  poolApp: pg.Pool,
  empresaId: string,
  quemAtribuiu: Autor,
  tarefaId: string,
  acordar?: (empresaId: string, execucaoId: string) => void,
  opcoes: { leuTextoDeOutros?: boolean } = {},
): Promise<string | null> {
  const id = await comEmpresa(poolApp, empresaId, async (c) => {
    // Duas atribuições ao mesmo tempo não criam duas execuções.
    await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`tarefa-do-agente:${tarefaId}`]);
    const a = await c.query<{ id: string; tipo: string; situacao: string; responsavel_id: string }>(
      `select g.id, g.tipo, g.situacao, g.responsavel_id from tarefas t
         join agentes g on g.id = t.responsavel_agente_id and g.empresa_id = t.empresa_id
        where t.id = $1 and t.empresa_id = empresa_ativa() and t.status not in ('concluida', 'cancelada')`,
      [tarefaId],
    );
    const agente = a.rows[0];
    if (!agente || agente.tipo !== "interno" || agente.situacao === "desligado") return null;
    // O próprio agente se atribuindo (ou a delegação, que cria a execução dela) não gera outra. Um agente interno que
    // atribui chama de novo com a pessoa em nome de quem age.
    if (quemAtribuiu.tipo === "agente") {
      if (quemAtribuiu.agenteId === agente.id) return null;
      const quem = await c.query<{ tipo: string }>(
        "select tipo from agentes where id = $1 and empresa_id = empresa_ativa()",
        [quemAtribuiu.agenteId],
      );
      if (quem.rows[0]?.tipo !== "externo") return null;
    }
    const aberta = await c.query(
      `select 1 from execucoes_de_agente where empresa_id = empresa_ativa() and agente_id = $1 and tarefa_id = $2
          and situacao in ('na_fila', 'rodando') limit 1`,
      [agente.id, tarefaId],
    );
    if ((aberta.rowCount ?? 0) > 0) return null;
    const e = await criarExecucao(c, {
      agenteId: agente.id,
      pedidoPor: quemAtribuiu.tipo === "pessoa" ? quemAtribuiu.pessoaId : agente.responsavel_id,
      origem: "tarefa",
      tarefaId,
      leuTextoDeOutros: opcoes.leuTextoDeOutros ?? false,
    });
    return agente.situacao === "ativo" ? e.id : null;
  });
  if (id && acordar) acordar(empresaId, id);
  return id;
}
