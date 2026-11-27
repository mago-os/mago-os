/**
 * Ferramentas de leitura das conversas para os agentes (M8-01, regra 12, decisão 0051 item 7): listar e ver. As
 * mesmas para os internos (com o alcance de quem pediu e o do responsável pelo agente) e para o MCP (com o do
 * responsável pelo agente externo). As de ação (mandar mensagem, nota, atribuir e resolver) entram na M8-11. O texto
 * das mensagens é sempre texto de outros (M4-04).
 */
import type { FiltroDeConversas } from "@mago-os/contratos";
import type pg from "pg";
import { comEmpresa } from "../empresa.ts";
import {
  buscarConversa,
  listarConversas,
  mensagensDaConversa,
  type QuemOlhaConversas,
  RecusaDasConversas,
} from "./servico.ts";

export const FERRAMENTAS_DE_CONVERSAS = ["listar_conversas", "ver_conversa"] as const;
export type FerramentaDeConversas = (typeof FERRAMENTAS_DE_CONVERSAS)[number];

export const eFerramentaDeConversas = (nome: string): nome is FerramentaDeConversas =>
  (FERRAMENTAS_DE_CONVERSAS as readonly string[]).includes(nome);

/** Quantas mensagens ver_conversa mostra (as últimas). */
export const MENSAGENS_NA_FERRAMENTA = 50;

export interface ContextoDasConversas {
  poolApp: pg.Pool;
  empresaId: string;
  /** Quem olha (vale o menor de todos). */
  olham: QuemOlhaConversas[];
  /** Limite de linhas da lista (o MCP devolve até 100). */
  limiteDaLista: number;
}

export async function executarFerramentaDeConversas(
  ctx: ContextoDasConversas,
  nome: FerramentaDeConversas,
  entrada: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (ctx.olham.some((q) => q.alcance === "nada"))
    throw new RecusaDasConversas("Quem você atende não pode ver as conversas com contatos.");
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(ctx.poolApp, ctx.empresaId, trabalho);
  switch (nome) {
    case "listar_conversas":
      return {
        conversas: await naEmpresa((c) =>
          listarConversas(c, ctx.olham, entrada as FiltroDeConversas, ctx.limiteDaLista),
        ),
      };
    case "ver_conversa": {
      const id = entrada.conversaId as string;
      const feito = await naEmpresa(async (c) => {
        const conversa = await buscarConversa(c, ctx.olham, id);
        if (!conversa) return null;
        return { conversa, mensagens: await mensagensDaConversa(c, id, MENSAGENS_NA_FERRAMENTA) };
      });
      if (!feito) throw new RecusaDasConversas("Conversa não encontrada entre as que você alcança.");
      return feito;
    }
  }
}
