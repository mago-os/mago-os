/**
 * Rotas da Central de agentes (M2-03), para a tela. Todo mundo da empresa vê os agentes (para escolher um como
 * responsável de tarefa); só o administrador cadastra, edita, pausa, retoma e desliga (padrão das permissões).
 * Desligar para o agente na hora: as tarefas que ele tinha pegado voltam para A fazer, as abertas passam para a
 * pessoa responsável, e ela recebe um aviso por e-mail. As chaves (M2-04) deixam de valer porque o agente
 * desligado é recusado.
 */
import {
  type ACOES_AGENTES,
  type Agente,
  conferir,
  MINUTOS_SEM_SINAL_PADRAO,
  PedidoDeAgente,
  PedidoDeEditarAgente,
  type SituacaoAgente,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Carteiro } from "../acesso/login.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { pessoaAtivaNaEmpresa } from "../tarefas/servico.ts";
import {
  buscarAgente,
  cadastrarAgente,
  contatoDoResponsavel,
  devolverTarefasPegadas,
  editarAgente,
  listarAgentes,
  mudarSituacao,
  passarTarefasAoResponsavel,
} from "./servico.ts";

type AcaoDeAgente = (typeof ACOES_AGENTES)[number];

export interface OpcoesDosAgentes {
  verificador: Verificador;
  poolApp: pg.Pool;
  carteiro: Carteiro;
  urlPublica: string;
}

const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "AGENTE_NAO_ENCONTRADO", message: "Agente não encontrado." });

/** Erro de nome repetido entre agentes vivos da mesma empresa (índice agentes_nome_unico). */
function nomeRepetido(erro: unknown): boolean {
  return (erro as { constraint?: string }).constraint === "agentes_nome_unico";
}

export function registrarRotasDosAgentes(app: FastifyInstance, o: OpcoesDosAgentes): void {
  const { verificador, poolApp } = o;
  const site = new URL(o.urlPublica).origin;

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  function registrar(pedido: FastifyRequest, acao: AcaoDeAgente, agenteId: string, detalhes = {}) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "agente", id: agenteId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }

  app.get("/agentes", { preHandler: verificador.exigir("agentes", "ver") }, async (pedido) =>
    naEmpresa(pedido, (c) => listarAgentes(c)),
  );

  app.get("/agentes/:id", { preHandler: verificador.exigir("agentes", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const lista = await naEmpresa(pedido, (c) => listarAgentes(c));
    return lista.find((a) => a.id === id) ?? naoEncontrado(resposta);
  });

  app.post("/agentes", { preHandler: verificador.exigir("agentes", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeAgente, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    try {
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await pessoaAtivaNaEmpresa(c, r.valor.responsavelId))) return null;
        return cadastrarAgente(c, {
          nome: r.valor.nome,
          descricao: r.valor.descricao ?? null,
          ondeRoda: r.valor.ondeRoda ?? null,
          responsavelId: r.valor.responsavelId,
          minutosSemSinal: r.valor.minutosSemSinal ?? MINUTOS_SEM_SINAL_PADRAO,
        });
      });
      if (!feito) return responsavelInvalido(resposta);
      await registrar(pedido, "agente.cadastrou", feito.id, { tipo: feito.tipo });
      return resposta.code(201).send(feito);
    } catch (erro) {
      if (nomeRepetido(erro)) return nomeEmUso(resposta);
      throw erro;
    }
  });

  app.post(
    "/agentes/:id",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarAgente, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          const atual = await buscarAgente(c, id, true);
          if (!atual) return "nao_encontrado" as const;
          if (atual.situacao === "desligado") return "desligado" as const;
          const responsavelId = r.valor.responsavelId ?? atual.responsavelId;
          if (r.valor.responsavelId && !(await pessoaAtivaNaEmpresa(c, responsavelId))) {
            return "responsavel" as const;
          }
          return editarAgente(c, atual, {
            nome: r.valor.nome ?? atual.nome,
            descricao: r.valor.descricao === undefined ? atual.descricao : r.valor.descricao,
            ondeRoda: r.valor.ondeRoda === undefined ? atual.ondeRoda : r.valor.ondeRoda,
            responsavelId,
            minutosSemSinal: r.valor.minutosSemSinal ?? atual.minutosSemSinal,
          });
        });
        if (feito === "nao_encontrado") return naoEncontrado(resposta);
        if (feito === "desligado") return desligadoNaoMuda(resposta);
        if (feito === "responsavel") return responsavelInvalido(resposta);
        await registrar(pedido, "agente.editou", id, { campos: Object.keys(r.valor) });
        return feito;
      } catch (erro) {
        if (nomeRepetido(erro)) return nomeEmUso(resposta);
        throw erro;
      }
    },
  );

  /** Pausar e retomar: só muda a situação (as chaves continuam guardadas). */
  function rotaDeSituacao(caminho: string, para: SituacaoAgente, de: SituacaoAgente, acao: AcaoDeAgente) {
    app.post(caminho, { preHandler: verificador.exigir("agentes", "editar") }, async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = await buscarAgente(c, id, true);
        if (!atual) return null;
        if (atual.situacao !== de) return atual.situacao;
        return mudarSituacao(c, id, para);
      });
      if (!feito) return naoEncontrado(resposta);
      if (typeof feito === "string") {
        return resposta.code(409).send({
          code: "SITUACAO_INVALIDA",
          message: feito === "desligado" ? "Agente desligado não volta." : `O agente já está ${feito}.`,
        });
      }
      await registrar(pedido, acao, id);
      return feito;
    });
  }
  rotaDeSituacao("/agentes/:id/pausar", "pausado", "ativo", "agente.pausou");
  rotaDeSituacao("/agentes/:id/retomar", "ativo", "pausado", "agente.retomou");

  app.post(
    "/agentes/:id/desligar",
    { preHandler: verificador.exigir("agentes", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = await buscarAgente(c, id, true);
        if (!atual) return null;
        if (atual.situacao === "desligado") return "desligado" as const;
        const agente: Agente = await mudarSituacao(c, id, "desligado");
        const devolvidas = await devolverTarefasPegadas(
          c,
          id,
          `O agente ${agente.nome} foi desligado e a tarefa voltou para A fazer.`,
        );
        const passadas = await passarTarefasAoResponsavel(c, agente);
        const contato = await contatoDoResponsavel(c, agente.responsavelId);
        return { agente, tarefas: [...devolvidas, ...passadas], contato };
      });
      if (!feito) return naoEncontrado(resposta);
      if (feito === "desligado") return desligadoNaoMuda(resposta);
      await registrar(pedido, "agente.desligou", id, { tarefasDevolvidas: feito.tarefas.length });
      if (feito.contato && o.carteiro.enviarAvisoDeAgente) {
        // O aviso não segura o desligamento: se o e-mail falhar, fica no log.
        await o.carteiro
          .enviarAvisoDeAgente({
            para: feito.contato.email,
            nome: feito.contato.nome,
            agente: feito.agente.nome,
            oQueAconteceu: "foi desligado",
            tarefas: [...new Set(feito.tarefas.map((t) => t.titulo))],
            link: `${site}/agentes/${id}`,
          })
          .catch((erro) => pedido.log.error({ erro }, "Aviso de agente desligado: e-mail não saiu"));
      }
      return feito.agente;
    },
  );
}

const responsavelInvalido = (resposta: FastifyReply) =>
  resposta.code(400).send({
    code: "RESPONSAVEL_INVALIDO",
    message: "A pessoa responsável precisa estar ativa nesta empresa.",
  });

const nomeEmUso = (resposta: FastifyReply) =>
  resposta
    .code(409)
    .send({ code: "NOME_EM_USO", message: "Já existe um agente com esse nome nesta empresa." });

const desligadoNaoMuda = (resposta: FastifyReply) =>
  resposta.code(409).send({ code: "AGENTE_DESLIGADO", message: "Agente desligado não muda mais." });
