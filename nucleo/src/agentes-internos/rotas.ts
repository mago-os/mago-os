/**
 * Conversa com o coordenador no app (M4-02, decisão 5 da spec). Cada pessoa vê só as conversas dela. A mensagem da
 * pessoa vira uma execução na fila; a resposta do agente chega na conversa (a tela acompanha a execução).
 */
import { conferir, PedidoDeMensagem } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { garantirAgentesDeNascenca } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  apagarConversa,
  buscarConversa,
  criarConversa,
  criarExecucao,
  execucoesEmAndamento,
  gravarMensagem,
  listarConversas,
  listarMensagens,
} from "./dados.ts";

export interface OpcoesDaConversa {
  verificador: Verificador;
  poolApp: pg.Pool;
  acordar(empresaId: string, execucaoId: string): void;
}

const naoEncontrada = (r: FastifyReply) =>
  r.code(404).send({ code: "CONVERSA_NAO_ENCONTRADA", message: "Conversa não encontrada." });

export function registrarRotasDaConversa(app: FastifyInstance, o: OpcoesDaConversa): void {
  const { verificador, poolApp } = o;
  // Todo mundo da empresa fala com o coordenador (o que o agente faz depois respeita a permissão de cada um).
  const exigir = verificador.exigir("agentes", "ver");

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  app.get("/conversas", { preHandler: exigir }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    return naEmpresa(pedido, async (c) => {
      await garantirAgentesDeNascenca(c);
      const coordenador = await c.query<{ id: string; nome: string; situacao: string }>(
        `select id, nome, situacao from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
            and papel = 'coordenador' and situacao <> 'desligado' limit 1`,
      );
      return {
        coordenador: coordenador.rows[0] ?? null,
        conversas: await listarConversas(c, sessao.pessoa.id),
      };
    });
  });

  app.get("/conversas/:id", { preHandler: exigir }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const feito = await naEmpresa(pedido, async (c) => {
      const conversa = await buscarConversa(c, id);
      if (!conversa) return null;
      return {
        conversa,
        mensagens: await listarMensagens(c, id),
        emAndamento: await execucoesEmAndamento(c, id),
      };
    });
    return feito ?? naoEncontrada(resposta);
  });

  app.post("/conversas/mensagens", { preHandler: exigir }, async (pedido, resposta) => {
    const r = conferir(PedidoDeMensagem, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const { sessao } = acessoDo(pedido);
    const feito = await naEmpresa(pedido, async (c) => {
      await garantirAgentesDeNascenca(c);
      let conversa = r.valor.conversaId ? await buscarConversa(c, r.valor.conversaId) : null;
      if (r.valor.conversaId && !conversa) return { erro: "nao_encontrada" as const };
      const agenteId = conversa?.agenteId;
      const a = await c.query<{ id: string; nome: string; situacao: string }>(
        `select id, nome, situacao from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
            and ${agenteId ? "id = $1" : "papel = 'coordenador' and situacao <> 'desligado'"} limit 1`,
        agenteId ? [agenteId] : [],
      );
      const agente = a.rows[0];
      if (!agente) return { erro: "sem_coordenador" as const };
      if (agente.situacao !== "ativo") return { erro: "pausado" as const, nome: agente.nome };
      // Uma execução de cada vez por conversa: a pessoa espera a resposta antes de mandar outra. A linha da conversa
      // fica travada até o fim da transação, para dois envios ao mesmo tempo não criarem duas execuções.
      if (conversa) {
        await c.query("select 1 from conversas where id = $1 and empresa_id = empresa_ativa() for update", [
          conversa.id,
        ]);
        if ((await execucoesEmAndamento(c, conversa.id)) > 0) return { erro: "ocupado" as const };
      }
      conversa ??= await criarConversa(c, sessao.pessoa.id, agente.id, r.valor.texto);
      const mensagem = await gravarMensagem(
        c,
        conversa,
        { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        r.valor.texto,
      );
      const execucao = await criarExecucao(c, {
        agenteId: agente.id,
        pedidoPor: sessao.pessoa.id,
        origem: "conversa",
        conversaId: conversa.id,
      });
      return { conversa, mensagem, execucaoId: execucao.id };
    });
    if ("erro" in feito) {
      if (feito.erro === "nao_encontrada") return naoEncontrada(resposta);
      if (feito.erro === "ocupado")
        return resposta
          .code(409)
          .send({ code: "AGENTE_OCUPADO", message: "O agente ainda está respondendo a mensagem anterior." });
      return resposta.code(409).send({
        code: "AGENTE_PAUSADO",
        message:
          feito.erro === "pausado"
            ? `${feito.nome} ainda está pausado. O administrador escolhe o modelo de IA e liga em Agentes.`
            : "Esta empresa ainda não tem coordenador.",
      });
    }
    o.acordar(sessao.empresaId, feito.execucaoId);
    return resposta.code(201).send(feito);
  });

  app.delete("/conversas/:id", { preHandler: exigir }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const { sessao } = acessoDo(pedido);
    const apagou = await naEmpresa(pedido, (c) => apagarConversa(c, id));
    if (!apagou) return naoEncontrada(resposta);
    await auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao: "conversa.apagou",
        alvo: { tipo: "conversa", id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: {},
      },
      pedido.log,
    );
    return resposta.code(204).send();
  });
}
