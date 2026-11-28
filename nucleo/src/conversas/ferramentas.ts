/**
 * Ferramentas das conversas para os agentes (regra 12): listar e ver (M8-01, decisão 0051 item 7) e as ações (M8-11,
 * decisão 0060): mandar mensagem ao contato, escrever nota, atribuir e resolver. As mesmas para os internos (com o
 * alcance de quem pediu e o do responsável pelo agente) e para o MCP (com o do responsável pelo agente externo). O
 * texto das mensagens é sempre texto de outros (M4-04). Mandar mensagem pede aprovação por padrão (catálogo de ações):
 * quando chega aqui, já foi aprovada ou o administrador liberou.
 */
import type { FiltroDeConversas } from "@mago-os/contratos";
import type pg from "pg";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { comEmpresa } from "../empresa.ts";
import { passarConversaPara } from "./acoes.ts";
import { criarMensagemQueSai } from "./envio.ts";
import {
  type AcaoNasConversas,
  buscarConversa,
  listarConversas,
  mensagensDaConversa,
  type QuemOlhaConversas,
  RecusaDasConversas,
  resolverConversa,
} from "./servico.ts";

export const FERRAMENTAS_DE_CONVERSAS = [
  "listar_conversas",
  "ver_conversa",
  "mandar_mensagem_ao_contato",
  "escrever_nota_na_conversa",
  "atribuir_conversa",
  "resolver_conversa",
] as const;
export type FerramentaDeConversas = (typeof FERRAMENTAS_DE_CONVERSAS)[number];

export const eFerramentaDeConversas = (nome: string): nome is FerramentaDeConversas =>
  (FERRAMENTAS_DE_CONVERSAS as readonly string[]).includes(nome);

/** Quantas mensagens ver_conversa mostra (as últimas). */
export const MENSAGENS_NA_FERRAMENTA = 50;

export interface ContextoDasConversas {
  poolApp: pg.Pool;
  empresaId: string;
  /** Quem olha, por ação (vale o menor de todos). */
  olham: (acao: AcaoNasConversas) => QuemOlhaConversas[];
  /** Limite de linhas da lista (o MCP devolve até 100). */
  limiteDaLista: number;
  /** O agente que age (as ações ficam no nome dele). */
  agente: { id: string; nome: string };
  /** Põe a mensagem na fila de envio ao contato; sem ela, mandar mensagem recusa. */
  enviarAoContato?: ((empresaId: string, mensagemId: string) => Promise<void>) | undefined;
  origem: DadosDoEvento["origem"];
  rastreio: string | null;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  /** Detalhes que vão em toda auditoria (ex.: quem pediu). */
  detalhes?: Record<string, unknown>;
}

export async function executarFerramentaDeConversas(
  ctx: ContextoDasConversas,
  nome: FerramentaDeConversas,
  entrada: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (ctx.olham("ver").some((q) => q.alcance === "nada"))
    throw new RecusaDasConversas("Quem você atende não pode ver as conversas com contatos.");
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(ctx.poolApp, ctx.empresaId, trabalho);
  const naoAchou = () => new RecusaDasConversas("Conversa não encontrada entre as que você alcança.");
  const conversaId = entrada.conversaId as string;
  const registrar = (acao: string, detalhes: Record<string, unknown>) =>
    auditar(
      ctx.poolApp,
      {
        empresaId: ctx.empresaId,
        ator: { tipo: "agente", agenteId: ctx.agente.id },
        acao,
        alvo: { tipo: "conversa", id: conversaId },
        origem: ctx.origem,
        rastreio: ctx.rastreio,
        detalhes: { ...ctx.detalhes, ...detalhes },
      },
      ctx.log,
    );
  /** A conversa que quem olha alcança para a ação (com a linha travada, para mudar). */
  const daAcao = async (c: pg.PoolClient, acao: AcaoNasConversas) => {
    const olham = ctx.olham(acao);
    if (olham.some((q) => q.alcance === "nada"))
      throw new RecusaDasConversas("Quem você atende não pode fazer isso nas conversas.");
    const conversa = await buscarConversa(c, olham, conversaId, true);
    if (!conversa) throw naoAchou();
    return conversa;
  };

  switch (nome) {
    case "listar_conversas":
      return {
        conversas: await naEmpresa((c) =>
          listarConversas(c, ctx.olham("ver"), entrada as FiltroDeConversas, ctx.limiteDaLista),
        ),
      };
    case "ver_conversa": {
      const feito = await naEmpresa(async (c) => {
        const conversa = await buscarConversa(c, ctx.olham("ver"), conversaId);
        if (!conversa) return null;
        return { conversa, mensagens: await mensagensDaConversa(c, conversaId, MENSAGENS_NA_FERRAMENTA) };
      });
      if (!feito) throw naoAchou();
      return feito;
    }
    case "mandar_mensagem_ao_contato": {
      const enviar = ctx.enviarAoContato;
      if (!enviar) throw new RecusaDasConversas("O envio aos contatos não está ligado neste ambiente.");
      const mensagemId = await naEmpresa(async (c) => {
        const conversa = await daAcao(c, "criar");
        return criarMensagemQueSai(
          { poolApp: ctx.poolApp, arquivos: null },
          c,
          ctx.empresaId,
          conversa,
          { agenteId: ctx.agente.id },
          { texto: entrada.texto as string },
        );
      });
      await enviar(ctx.empresaId, mensagemId);
      await registrar("conversa.enviou", { mensagemId, comArquivo: false });
      return { conversaId, mensagemId };
    }
    case "escrever_nota_na_conversa": {
      const mensagemId = await naEmpresa(async (c) => {
        const conversa = await daAcao(c, "criar");
        const m = await c.query<{ id: string }>(
          `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, autor_agente_id, tipo, texto)
           values (empresa_ativa(), $1, $2, 'interna', 'agente', $3, 'nota', $4) returning id`,
          [conversa.id, conversa.canal.id, ctx.agente.id, (entrada.texto as string).trim()],
        );
        return m.rows[0]?.id as string;
      });
      await registrar("conversa.anotou", { mensagemId, mencoes: [] });
      return { conversaId, mensagemId };
    }
    case "atribuir_conversa": {
      const pessoaId = entrada.pessoaId as string;
      const conversa = await naEmpresa(async (c) => {
        const atual = await daAcao(c, "editar");
        await passarConversaPara(c, ctx.poolApp, ctx.empresaId, atual, pessoaId, {
          pessoaId: null,
          nome: ctx.agente.nome,
        });
        return (await buscarConversa(c, ctx.olham("ver"), conversaId)) ?? atual;
      });
      await registrar("conversa.passou", { para: pessoaId });
      return { conversa };
    }
    case "resolver_conversa": {
      const conversa = await naEmpresa(async (c) => {
        const atual = await daAcao(c, "editar");
        if (atual.situacao === "resolvida") throw new RecusaDasConversas("A conversa já está resolvida.");
        await resolverConversa(c, atual.id, null);
        return (await buscarConversa(c, ctx.olham("ver"), conversaId)) ?? atual;
      });
      await registrar("conversa.resolveu", {});
      return { conversa };
    }
  }
}
