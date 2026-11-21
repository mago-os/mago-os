/**
 * Regras e aprovações pela tela (M4-03, decisão 0025): ver e mudar as regras de um agente, ver os pedidos, aprovar
 * (podendo editar) ou recusar, e a verificação a cada minuto que vence os pedidos de mais de 24 horas.
 *
 * A ação aprovada roda como o agente: o interno pelas ferramentas dele, com a permissão de quem pediu conferida de
 * novo; o externo pela mesma função do MCP. Antes, o núcleo confere que os parâmetros são os que a pessoa viu.
 */
import {
  type Aprovacao,
  conferir,
  type DeclaracaoDeModulo,
  FERRAMENTAS_INTERNAS,
  FERRAMENTAS_MCP,
  type PapelDeAgente,
  PedidoDeDecisao,
  PedidoDeMudarRegras,
  SITUACOES_DA_APROVACAO,
  type SituacaoDaAprovacao,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import type { OpcoesDaChave } from "../agentes/chaves.ts";
import {
  buscarAprovacao,
  concluirAprovacao,
  conferenciaDe,
  listarAprovacoes,
  listarRegras,
  mudarRegras,
  podeDecidir,
  registrarDecisao,
  reservarAprovacao,
  resumoDaAcao,
} from "../agentes/regras.ts";
import { buscarAgente } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { executar, RecusaDaFerramenta } from "../mcp/index.ts";
import { acessoDo, permissoesNaEmpresa, type Verificador } from "../permissoes/verificar.ts";
import { buscarConversa, buscarExecucao, type ExecucaoComInstrucoes, gravarMensagem } from "./dados.ts";
import { executarFerramenta } from "./ferramentas.ts";

export interface OpcoesDasAprovacoes {
  verificador: Verificador;
  poolApp: pg.Pool;
  catalogo: Map<string, DeclaracaoDeModulo>;
  opcoesMcp: OpcoesDaChave;
  acordar(empresaId: string, execucaoId: string): void;
}

const naoEncontrado = (r: FastifyReply, o = "Pedido de aprovação") =>
  r.code(404).send({ code: "NAO_ENCONTRADO", message: `${o} não encontrado.` });

/** Executa a ação aprovada como o agente. Devolve o resultado, ou lança RecusaDaFerramenta com o motivo. */
export async function executarAprovado(
  o: OpcoesDasAprovacoes,
  empresaId: string,
  aprovacao: Aprovacao,
  parametros: Record<string, unknown>,
  log: FastifyRequest["log"],
): Promise<unknown> {
  const agente = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{
      id: string;
      nome: string;
      tipo: string;
      papel: PapelDeAgente | null;
      situacao: string;
    }>("select id, nome, tipo, papel, situacao from agentes where id = $1 and empresa_id = empresa_ativa()", [
      aprovacao.agenteId,
    ]);
    return r.rows[0] ?? null;
  });
  if (!agente || agente.situacao === "desligado") throw new RecusaDaFerramenta("O agente foi desligado.");
  if (agente.tipo === "externo") {
    if (!FERRAMENTAS_MCP.some((f) => f.nome === aprovacao.acao))
      throw new RecusaDaFerramenta("Ação desconhecida.");
    return executar(
      aprovacao.acao as never,
      parametros as never,
      { empresaId, agenteId: agente.id, chaveId: "" },
      o.opcoesMcp,
      { log },
    );
  }
  if (!agente.papel) throw new RecusaDaFerramenta("O agente não é um agente interno.");
  const permissoes = await permissoesNaEmpresa(o.poolApp, aprovacao.pedidoPor, empresaId, o.catalogo);
  if (!permissoes) throw new RecusaDaFerramenta("Quem pediu não está mais ativo na empresa.");
  // A execução de origem (se ainda existir) dá quem pediu e a conversa; sem ela, uma execução só de contexto, que
  // não vai para o banco (semExecucao: a delegação e a auditoria não citam esse id).
  const origem = aprovacao.execucaoId
    ? await comEmpresa(o.poolApp, empresaId, (c) => buscarExecucao(c, aprovacao.execucaoId as string))
    : null;
  const execucao: ExecucaoComInstrucoes = origem ?? {
    id: aprovacao.id,
    empresaId,
    agenteId: agente.id,
    pedidoPor: aprovacao.pedidoPor,
    origem: "tarefa",
    conversaId: null,
    tarefaId: aprovacao.tarefaId,
    execucaoMaeId: null,
    situacao: "concluida",
    modeloUsado: null,
    passouAoReservaPorque: null,
    resumo: null,
    criadaEm: aprovacao.criadaEm,
    iniciadaEm: aprovacao.criadaEm,
    terminadaEm: aprovacao.criadaEm,
    instrucoes: null,
  };
  const feito = await executarFerramenta(
    {
      poolApp: o.poolApp,
      empresaId,
      agente: { id: agente.id, nome: agente.nome, papel: agente.papel },
      execucao: { ...execucao, pedidoPor: aprovacao.pedidoPor },
      permissoes,
      opcoesMcp: o.opcoesMcp,
      log,
      acordar: (id) => o.acordar(empresaId, id),
      semExecucao: !origem,
    },
    aprovacao.acao,
    parametros,
    { aprovada: true },
  );
  return feito.conteudo;
}

/** A notícia da decisão na conversa de onde o pedido saiu (do agente interno). */
async function avisarNaConversa(c: pg.PoolClient, aprovacao: Aprovacao, texto: string): Promise<void> {
  if (!aprovacao.execucaoId) return;
  const execucao = await buscarExecucao(c, aprovacao.execucaoId);
  let conversaId = execucao?.conversaId ?? null;
  if (!conversaId && execucao?.execucaoMaeId)
    conversaId = (await buscarExecucao(c, execucao.execucaoMaeId))?.conversaId ?? null;
  const conversa = conversaId ? await buscarConversa(c, conversaId) : null;
  if (conversa)
    await gravarMensagem(c, conversa, { tipo: "sistema" }, texto, {
      tarefas: aprovacao.tarefaId ? [aprovacao.tarefaId] : [],
    });
}

/** A ferramenta de uma ação (para conferir os parâmetros editados). */
function entradaDa(acao: string, tipo: string) {
  return tipo === "externo"
    ? FERRAMENTAS_MCP.find((f) => f.nome === acao)?.entrada
    : (FERRAMENTAS_INTERNAS.find((f) => f.nome === acao)?.entrada ??
        FERRAMENTAS_MCP.find((f) => f.nome === acao)?.entrada);
}

export function registrarRotasDasAprovacoes(app: FastifyInstance, o: OpcoesDasAprovacoes): void {
  const { verificador, poolApp } = o;

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }
  const ehAdministrador = (pedido: FastifyRequest) => acessoDo(pedido).permissoes.perfil === "administrador";
  function registrar(
    pedido: FastifyRequest,
    acao: string,
    alvo: { tipo: string; id: string },
    detalhes: Record<string, unknown>,
  ) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo,
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }

  // Regras de um agente: todos veem; o administrador muda; o responsável pelo agente só deixa mais restrito.
  app.get(
    "/agentes/:id/regras",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const agente = await buscarAgente(c, id);
        if (!agente) return null;
        return {
          regras: await listarRegras(c, agente),
          podeMudar: ehAdministrador(pedido)
            ? ("tudo" as const)
            : agente.responsavelId === sessao.pessoa.id
              ? ("restringir" as const)
              : ("nada" as const),
        };
      });
      return feito ?? naoEncontrado(resposta, "Agente");
    },
  );

  app.post(
    "/agentes/:id/regras",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeMudarRegras, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const { sessao } = acessoDo(pedido);
      const administrador = ehAdministrador(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const agente = await buscarAgente(c, id, true);
        if (!agente) return { erro: 404 as const };
        if (!administrador && agente.responsavelId !== sessao.pessoa.id) return { erro: 403 as const };
        if (agente.situacao === "desligado") return { erro: 409 as const };
        const m = await mudarRegras(c, agente, r.valor.regras, { pessoaId: sessao.pessoa.id, administrador });
        if ("problema" in m) return { problema: m.problema };
        return { mudou: m.mudou, regras: await listarRegras(c, agente) };
      });
      if ("erro" in feito) {
        if (feito.erro === 404) return naoEncontrado(resposta, "Agente");
        if (feito.erro === 409)
          return resposta
            .code(409)
            .send({ code: "AGENTE_DESLIGADO", message: "Agente desligado não muda mais." });
        return resposta.code(403).send({
          code: "SEM_PERMISSAO",
          message: "Só o administrador e o responsável pelo agente mudam as regras.",
        });
      }
      if ("problema" in feito)
        return resposta.code(400).send({ code: "REGRA_INVALIDA", message: feito.problema });
      for (const m of feito.mudou) await registrar(pedido, "agente.mudou_regra", { tipo: "agente", id }, m);
      return feito.regras;
    },
  );

  // Pedidos de aprovação: quem pediu, o responsável pelo agente e os administradores veem e decidem.
  app.get("/aprovacoes", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const q = pedido.query as { situacao?: string };
    const situacao = SITUACOES_DA_APROVACAO.includes(q.situacao as SituacaoDaAprovacao)
      ? (q.situacao as SituacaoDaAprovacao)
      : null;
    const { sessao } = acessoDo(pedido);
    return naEmpresa(pedido, (c) => listarAprovacoes(c, sessao.pessoa.id, ehAdministrador(pedido), situacao));
  });

  app.get(
    "/aprovacoes/:id",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const a = await buscarAprovacao(c, id);
        if (!a || !(await podeDecidir(c, a, sessao.pessoa.id, ehAdministrador(pedido)))) return null;
        const agente = await buscarAgente(c, a.agenteId);
        return {
          ...a,
          agenteNome: agente?.nome ?? "Agente",
          vencida: a.situacao === "pendente" && Date.parse(a.venceEm) <= Date.now(),
        };
      });
      return feito ?? naoEncontrado(resposta);
    },
  );

  app.post(
    "/aprovacoes/:id/decidir",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeDecisao, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const { sessao } = acessoDo(pedido);
      const administrador = ehAdministrador(pedido);
      const nomeDe = await naEmpresa(pedido, async (c) => {
        const p = await c.query<{ nome: string }>("select nome from pessoas where id = $1", [
          sessao.pessoa.id,
        ]);
        return p.rows[0]?.nome ?? "Alguém";
      });
      const jaDecidido = () =>
        resposta.code(409).send({ code: "PEDIDO_MUDOU", message: "Este pedido já foi decidido ou venceu." });

      // 1. Confere o pedido e, ao aprovar, os parâmetros editados; depois troca "pendente" pela decisão numa
      // operação só, para dois cliques ao mesmo tempo não fazerem a ação duas vezes.
      const conferido = await naEmpresa(pedido, async (c) => {
        const a = await buscarAprovacao(c, id, true);
        if (!a || !(await podeDecidir(c, a, sessao.pessoa.id, administrador))) return { erro: 404 as const };
        if (a.situacao !== "pendente" || Date.parse(a.venceEm) <= Date.now()) return { erro: 409 as const };
        if (r.valor.conferencia !== a.conferencia)
          return {
            erro: 409 as const,
            message: "O pedido mudou desde que você abriu. Abra de novo e confira.",
          };
        if (r.valor.decisao === "recusar") {
          const motivo = r.valor.motivo;
          const d = await registrarDecisao(c, a, {
            situacao: "recusada",
            decididaPor: sessao.pessoa.id,
            observacao: motivo,
          });
          if (!d) return { erro: 409 as const };
          await avisarNaConversa(c, a, `${nomeDe} recusou: ${a.resumo}. Motivo: ${motivo}`);
          return { recusada: d };
        }
        const agente = await buscarAgente(c, a.agenteId);
        const editados = r.valor.parametros;
        let parametros = a.parametros;
        let editada = false;
        if (editados) {
          const formato = entradaDa(a.acao, agente?.tipo ?? "interno");
          if (!formato || !conferir(formato as never, editados).ok)
            return { invalido: "Os parâmetros editados estão fora do formato da ação." };
          // A tarefa não muda ao aprovar: o pedido, o resumo e a regra são daquela tarefa.
          if (editados.tarefaId !== a.parametros.tarefaId)
            return { invalido: "Não dá para trocar a tarefa ao aprovar. Recuse e peça de novo." };
          editada = conferenciaDe(editados) !== a.conferencia;
          parametros = editados;
        }
        const resumo = editada ? await resumoDaAcao(c, a.acao, parametros) : a.resumo;
        const reservada = await reservarAprovacao(c, a, {
          decididaPor: sessao.pessoa.id,
          parametros,
          editada,
          resumo,
        });
        if (!reservada) return { erro: 409 as const };
        return { aprovacao: reservada, tipo: agente?.tipo ?? "interno" };
      });
      if ("erro" in conferido) {
        if (conferido.erro === 404) return naoEncontrado(resposta);
        if ("message" in conferido)
          return resposta.code(409).send({ code: "PEDIDO_MUDOU", message: conferido.message });
        return jaDecidido();
      }
      if ("invalido" in conferido)
        return resposta.code(400).send({ code: "PARAMETROS_INVALIDOS", message: conferido.invalido });
      if ("recusada" in conferido) {
        const d = conferido.recusada;
        await registrar(pedido, "aprovacao.recusou", { tipo: "aprovacao", id }, { acao: d.acao });
        await avisarDecisao(d, sessao.pessoa.id, `${nomeDe} recusou: ${d.resumo}`);
        return d;
      }

      // 2. Executa como o agente (fora da transação do pedido) e registra o resultado.
      const { aprovacao } = conferido;
      let resultado: unknown = null;
      let erro: string | null = null;
      try {
        resultado = await executarAprovado(o, sessao.empresaId, aprovacao, aprovacao.parametros, pedido.log);
      } catch (e) {
        if (!(e instanceof RecusaDaFerramenta)) {
          pedido.log.error({ erro: e, aprovacaoId: id }, "Aprovação: a ação falhou");
          erro = "Não foi possível concluir a ação agora.";
        } else erro = e.message;
      }
      const feita = await naEmpresa(pedido, async (c) => {
        const d = await concluirAprovacao(c, aprovacao, erro ? { erro } : { resultado });
        await avisarNaConversa(
          c,
          aprovacao,
          erro
            ? `${nomeDe} aprovou, mas não deu certo: ${aprovacao.resumo}. ${erro}`
            : `${nomeDe} aprovou: ${aprovacao.resumo}. Feito.`,
        );
        return d;
      });
      await registrar(
        pedido,
        erro ? "aprovacao.falhou" : "aprovacao.aprovou",
        { tipo: "aprovacao", id },
        { acao: aprovacao.acao, editada: aprovacao.editada },
      );
      await avisarDecisao(
        aprovacao,
        sessao.pessoa.id,
        `${nomeDe} aprovou: ${aprovacao.resumo}${erro ? " (não deu certo)" : ""}`,
      );
      return feita;
    },
  );

  /** Avisa quem pediu e o responsável pelo agente da decisão (menos quem decidiu). */
  async function avisarDecisao(aprovacao: Aprovacao, quemDecidiu: string, texto: string) {
    await comEmpresa(poolApp, aprovacao.empresaId, async (c) => {
      const r = await c.query<{ responsavel_id: string }>(
        "select responsavel_id from agentes where id = $1 and empresa_id = empresa_ativa()",
        [aprovacao.agenteId],
      );
      for (const pessoaId of new Set([aprovacao.pedidoPor, r.rows[0]?.responsavel_id]))
        if (pessoaId && pessoaId !== quemDecidiu)
          await criarAviso(c, {
            pessoaId,
            tipo: "aprovacao_decidida",
            texto,
            link: `/aprovacoes/${aprovacao.id}`,
          });
    }).catch(() => {});
  }
}

/** Verificação a cada minuto: pedidos de mais de 24 horas vencem (a ação não acontece) e quem pediu é avisado. */
export async function verificarAprovacoesVencidas(
  poolApp: pg.Pool,
  log: { error(obj: unknown, msg?: string): void },
): Promise<number> {
  const r = await poolApp.query<{ empresa_id: string; aprovacao_id: string }>(
    "select empresa_id, aprovacao_id from aprovacoes_vencidas()",
  );
  for (const v of r.rows) {
    try {
      const vencida = await comEmpresa(poolApp, v.empresa_id, async (c) => {
        const a = await buscarAprovacao(c, v.aprovacao_id, true);
        if (a?.situacao !== "pendente") return null;
        if (!(await registrarDecisao(c, a, { situacao: "vencida", decididaPor: null, observacao: null })))
          return null;
        await avisarNaConversa(c, a, `O pedido venceu sem decisão (24 horas): ${a.resumo}. Nada foi feito.`);
        await criarAviso(c, {
          pessoaId: a.pedidoPor,
          tipo: "aprovacao_decidida",
          texto: `Venceu sem decisão: ${a.resumo}`,
          link: `/aprovacoes/${a.id}`,
        });
        return a;
      });
      if (vencida)
        await auditar(
          poolApp,
          {
            empresaId: v.empresa_id,
            ator: { tipo: "sistema", servico: "aprovacoes" },
            acao: "aprovacao.venceu",
            alvo: { tipo: "aprovacao", id: v.aprovacao_id },
            origem: { canal: "sistema", ip: null, aparelho: null },
            rastreio: null,
            detalhes: { acao: vencida.acao },
          },
          log,
        );
    } catch (erro) {
      log.error({ erro, aprovacaoId: v.aprovacao_id }, "Aprovações: não venceu o pedido");
    }
  }
  return r.rowCount ?? 0;
}
