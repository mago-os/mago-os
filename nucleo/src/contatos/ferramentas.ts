/**
 * Ferramentas dos contatos para os agentes (M7-01, regra 12, decisão 0045): listar, ver, criar, atualizar e ligar a
 * uma tarefa. As mesmas para os internos (com a permissão de quem pediu e a do responsável pelo agente) e para o MCP
 * (com a permissão do responsável pelo agente externo). Juntar e apagar são de alto risco e ficam só na tela.
 * As recusas saem como RecusaDosContatos, e quem chama transforma no erro que o agente lê.
 */
import {
  conferirPedidoDeContato,
  conferirPedidoDeEditarContato,
  type FiltroDeContatos,
  type PedidoDeEditarContato,
  type Tarefa,
} from "@mago-os/contratos";
import type pg from "pg";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { comEmpresa } from "../empresa.ts";
import {
  buscarContato,
  criarContato,
  editarContato,
  ligarContatos,
  listarContatos,
  pessoasDaOrganizacao,
  type QuemOlhaContatos,
  RecusaDosContatos,
  resumosDe,
} from "./servico.ts";

export const FERRAMENTAS_DE_CONTATOS = [
  "listar_contatos",
  "ver_contato",
  "criar_contato",
  "atualizar_contato",
  "ligar_contato",
] as const;
export type FerramentaDeContatos = (typeof FERRAMENTAS_DE_CONTATOS)[number];

export const eFerramentaDeContatos = (nome: string): nome is FerramentaDeContatos =>
  (FERRAMENTAS_DE_CONTATOS as readonly string[]).includes(nome);

export interface ContextoDosContatos {
  poolApp: pg.Pool;
  empresaId: string;
  agenteId: string;
  /** Em nome de quem o agente cadastra (quem pediu; no MCP, o responsável pelo agente). */
  autorId: string;
  /** Quem olha em cada ação (vale o menor de todos). */
  olham: (acao: "ver" | "criar" | "editar") => QuemOlhaContatos[];
  /** As tarefas ligadas ao contato que o agente pode mostrar. */
  tarefasDoContato(c: pg.PoolClient, contatoId: string): Promise<Tarefa[]>;
  /** A tarefa que o agente pode mudar (para ligar contatos), ou nulo. */
  tarefaQueEdita(c: pg.PoolClient, tarefaId: string): Promise<Tarefa | null>;
  /** Limite de linhas da lista (o MCP devolve até 100). */
  limiteDaLista: number;
  origem: DadosDoEvento["origem"];
  rastreio: string | null;
  detalhes: Record<string, unknown>;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

const naoVe = (q: QuemOlhaContatos[]) => q.some((x) => x.alcance === "nada");

export async function executarFerramentaDeContatos(
  ctx: ContextoDosContatos,
  nome: FerramentaDeContatos,
  entrada: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(ctx.poolApp, ctx.empresaId, trabalho);
  const ver = ctx.olham("ver");
  if (naoVe(ver)) throw new RecusaDosContatos("Quem você atende não pode ver os contatos.");
  const registrar = (acao: string, alvo: { tipo: string; id: string }, detalhes: Record<string, unknown>) =>
    auditar(
      ctx.poolApp,
      {
        empresaId: ctx.empresaId,
        ator: { tipo: "agente", agenteId: ctx.agenteId },
        acao,
        alvo,
        origem: ctx.origem,
        rastreio: ctx.rastreio,
        detalhes: { ...ctx.detalhes, ...detalhes },
      },
      ctx.log,
    );

  switch (nome) {
    case "listar_contatos":
      return {
        contatos: await naEmpresa((c) =>
          listarContatos(c, ver, entrada as FiltroDeContatos, ctx.limiteDaLista),
        ),
      };
    case "ver_contato": {
      const id = entrada.contatoId as string;
      const feito = await naEmpresa(async (c) => {
        const contato = await buscarContato(c, ver, id);
        if (!contato || contato.situacao === "juntado") return null;
        return {
          contato,
          pessoasLigadas: contato.tipo === "organizacao" ? await pessoasDaOrganizacao(c, ver, id) : [],
          tarefas: (await ctx.tarefasDoContato(c, id)).map((t) => t.id),
        };
      });
      if (!feito) throw new RecusaDosContatos("Contato não encontrado entre os que você alcança.");
      return feito;
    }
    case "criar_contato": {
      const criar = ctx.olham("criar");
      if (naoVe(criar)) throw new RecusaDosContatos("Quem você atende não pode cadastrar contatos.");
      const r = conferirPedidoDeContato(entrada);
      if (!r.ok) throw new RecusaDosContatos(`Confira: ${r.problemas[0]?.mensagem ?? "os campos"}.`);
      const feito = await naEmpresa((c) =>
        criarContato(c, ver, { pessoaId: ctx.autorId, agenteId: ctx.agenteId }, r.valor),
      );
      await registrar(
        "contato.criou",
        { tipo: "contato", id: feito.contato.id },
        { tipo: feito.contato.tipo, repetidos: feito.repetidos.length },
      );
      return feito;
    }
    case "atualizar_contato": {
      const editar = ctx.olham("editar");
      if (naoVe(editar)) throw new RecusaDosContatos("Quem você atende não pode editar contatos.");
      const id = entrada.contatoId as string;
      const r = conferirPedidoDeEditarContato(entrada.mudancas);
      if (!r.ok) throw new RecusaDosContatos(`Confira: ${r.problemas[0]?.mensagem ?? "os campos"}.`);
      const feito = await naEmpresa(async (c) => {
        const antes = await buscarContato(c, editar, id, true);
        if (!antes) return null;
        return editarContato(c, ver, antes, r.valor as PedidoDeEditarContato);
      });
      if (!feito) throw new RecusaDosContatos("Contato não encontrado entre os que você pode editar.");
      const alvo = { tipo: "contato", id };
      if (feito.campos.includes("situacao"))
        await registrar(
          r.valor.situacao === "arquivado" ? "contato.arquivou" : "contato.desarquivou",
          alvo,
          {},
        );
      const outros = feito.campos.filter((x) => x !== "situacao");
      if (outros.length > 0) await registrar("contato.editou", alvo, { campos: outros });
      return { contato: feito.contato, repetidos: feito.repetidos };
    }
    case "ligar_contato": {
      const tarefaId = entrada.tarefaId as string;
      const contatos = entrada.contatos as string[];
      const feito = await naEmpresa(async (c) => {
        if (!(await ctx.tarefaQueEdita(c, tarefaId))) return null;
        const ids = await ligarContatos(c, ver, { tipo: "tarefa", id: tarefaId }, contatos);
        return (await resumosDe(c, ver, ids)).map((k) => k.id);
      });
      if (!feito) throw new RecusaDosContatos("Tarefa não encontrada entre as que você pode mudar.");
      await registrar("contato.ligou_tarefa", { tipo: "tarefa", id: tarefaId }, { contatos });
      return { tarefaId, contatos: feito };
    }
  }
}
