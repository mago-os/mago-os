/**
 * A mensagem que a pessoa manda a um agente interno, venha do app (POST /conversas/mensagens) ou do Telegram
 * (M5-02, decisão 0033): o mesmo caminho para os dois. Roda na transação da pessoa (comPessoa), na empresa dela.
 *
 * Continua a conversa (se veio uma) ou começa outra com o coordenador ou, se a pessoa puder, direto com um
 * especialista. Grava a mensagem e cria a execução; quem chamou põe a execução na fila (acordar).
 */
import type { CanalDaConversa, Conversa, MensagemDeConversa, Perfil } from "@mago-os/contratos";
import type pg from "pg";
import { paradaDoAgente } from "../agentes/parada.ts";
import { garantirAgentesDeNascenca } from "../agentes/servico.ts";
import {
  buscarConversa,
  criarConversa,
  criarExecucao,
  execucoesEmAndamento,
  gravarMensagem,
} from "./dados.ts";

/** Falar direto com um especialista: administrador e gestor de área (decisão de 13/11/2026). */
export function podeFalarComEspecialista(perfil: Perfil): boolean {
  return perfil === "administrador" || perfil === "gestor_area";
}

export interface MensagemDaPessoa {
  pessoaId: string;
  perfil: Perfil;
  texto: string;
  conversaId?: string | undefined;
  agenteId?: string | undefined;
  canal: CanalDaConversa;
}

export type ResultadoDaMensagem =
  | { conversa: Conversa; mensagem: MensagemDeConversa; execucaoId: string }
  | { erro: "nao_encontrada" | "sem_coordenador" | "sem_permissao" | "ocupado" }
  | { erro: "parados"; motivo: string }
  | { erro: "pausado"; nome: string };

export async function receberMensagemDaPessoa(
  c: pg.PoolClient,
  m: MensagemDaPessoa,
): Promise<ResultadoDaMensagem> {
  await garantirAgentesDeNascenca(c);
  let conversa = m.conversaId ? await buscarConversa(c, m.conversaId) : null;
  if (m.conversaId && !conversa) return { erro: "nao_encontrada" };
  // A conversa continua com o agente dela; uma nova vai ao coordenador ou, se pedido e permitido, ao especialista.
  const pedidoDireto = !conversa && m.agenteId ? m.agenteId : null;
  const agenteId = conversa?.agenteId ?? pedidoDireto;
  const a = await c.query<{ id: string; nome: string; situacao: string; papel: string }>(
    `select id, nome, situacao, papel from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
        and ${agenteId ? "id = $1 and situacao <> 'desligado'" : "papel = 'coordenador' and situacao <> 'desligado'"} limit 1`,
    agenteId ? [agenteId] : [],
  );
  const agente = a.rows[0];
  if (!agente) return { erro: pedidoDireto ? "nao_encontrada" : "sem_coordenador" };
  if (pedidoDireto && agente.papel === "especialista" && !podeFalarComEspecialista(m.perfil))
    return { erro: "sem_permissao" };
  if (agente.situacao !== "ativo") {
    // Os agentes foram parados (M4-09): a pessoa lê o motivo.
    const parada = await paradaDoAgente(c, agente.id);
    if (parada) return { erro: "parados", motivo: parada.motivo };
    return { erro: "pausado", nome: agente.nome };
  }
  // Uma execução de cada vez por conversa: a pessoa espera a resposta antes de mandar outra. A linha da conversa
  // fica travada até o fim da transação, para dois envios ao mesmo tempo não criarem duas execuções.
  if (conversa) {
    await c.query("select 1 from conversas where id = $1 and empresa_id = empresa_ativa() for update", [
      conversa.id,
    ]);
    if ((await execucoesEmAndamento(c, conversa.id)) > 0) return { erro: "ocupado" };
  }
  conversa ??= await criarConversa(c, m.pessoaId, agente.id, m.texto, m.canal);
  const mensagem = await gravarMensagem(c, conversa, { tipo: "pessoa", pessoaId: m.pessoaId }, m.texto, {
    canal: m.canal,
  });
  const execucao = await criarExecucao(c, {
    agenteId: agente.id,
    pedidoPor: m.pessoaId,
    origem: "conversa",
    conversaId: conversa.id,
  });
  return { conversa, mensagem, execucaoId: execucao.id };
}
