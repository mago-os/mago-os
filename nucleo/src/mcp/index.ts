/**
 * Mago OS como servidor MCP (M2-05). Ver docs/decisoes/0019-servidor-mcp.md.
 *
 * - POST /mcp, transporte HTTP do MCP sem sessão no servidor: cada pedido traz a chave do agente (M2-04) e é
 *   independente (regra 9). A chave é conferida antes de qualquer coisa; sem ela, 401.
 * - As ferramentas são as do contrato (contratos/src/mcp/ferramentas.ts): a entrada é conferida contra o contrato,
 *   e cada uma chama as mesmas funções das rotas da tela (nucleo/src/tarefas/servico.ts), com o agente como "quem
 *   pede": só as tarefas atribuídas a ele ou que ele pegou, só da empresa dele, trava respeitada.
 * - Cada mudança vira evento de auditoria com o agente como ator e o canal "mcp". Leituras contam para o limite.
 */

import {
  type ACOES_CHECKLIST,
  type ACOES_TAREFAS,
  conferir,
  type EntradaDa,
  FERRAMENTAS_MCP,
  MINUTOS_DO_LINK_DE_ANEXO,
  type NomeDaFerramenta,
  type StatusTarefa,
  type Tarefa,
} from "@mago-os/contratos";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Carteiro } from "../acesso/login.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import {
  type AgenteDoPedido,
  autenticarAgente,
  contarLeituras,
  type OpcoesDaChave,
} from "../agentes/chaves.ts";
import { avaliarAcao, criarAprovacao } from "../agentes/regras.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { registrarPasso } from "../agentes-internos/passos.ts";
import { entregarAoAgenteInterno } from "../agentes-internos/tarefa-atribuida.ts";
import { buscarAnexo, listarAnexos, type ServicosDosAnexos, semCaminho } from "../anexos/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois } from "../avisos/eventos.ts";
import { comEmpresa } from "../empresa.ts";
import { montarInstrucoes, skillsDoAgente } from "../instrucoes/servico.ts";
import { buscarItem, editarItem, listarChecklist } from "../tarefas/checklist.ts";
import {
  acontecimentoDaAcao,
  mencoesDoTexto,
  mencoesPendentes,
  registrarAcontecimento,
} from "../tarefas/linha-do-tempo.ts";
import { recorrerSePreciso } from "../tarefas/planejamento.ts";
import {
  autorDe,
  buscarTarefa,
  comentar,
  criarTarefa,
  listarComentarios,
  listarSubtarefas,
  listarTarefas,
  mudarStatus,
  pegarTarefa,
  pessoaAtivaNaEmpresa,
  type Quem,
  tirarTrava,
  travadaPorQuem,
  trocarResponsavel,
} from "../tarefas/servico.ts";

const ABERTOS: StatusTarefa[] = ["a_fazer", "em_andamento", "precisa_de_ajuda"];

export interface OpcoesDoMcp {
  poolApp: pg.Pool;
  carteiro: Carteiro;
  urlPublica: string;
  limites?: { pedidosPorMinuto: number; leiturasPorHora: number };
  anexos?: ServicosDosAnexos | null;
}

/** Recusa que o agente lê (vira isError na resposta da ferramenta). Os agentes internos usam a mesma (M4-02). */
export class RecusaDaFerramenta extends Error {
  override name = "RecusaDaFerramenta";
}

export type AcaoDeTarefa =
  | (typeof ACOES_TAREFAS)[number]
  | (typeof ACOES_CHECKLIST)[number]
  | "tarefa.mencionou"
  | "tarefa.recorreu";

export function registrarServidorMcp(app: FastifyInstance, o: OpcoesDoMcp): void {
  app.post("/mcp", async (pedido, resposta) => {
    const origem = { ...origemDoPedido(pedido), canal: "mcp" as const };
    const opcoesDaChave: OpcoesDaChave = {
      poolApp: o.poolApp,
      carteiro: o.carteiro,
      urlPublica: o.urlPublica,
      log: pedido.log,
      origem,
      rastreio: pedido.id,
      ...(o.limites ? { limites: o.limites } : {}),
      anexos: o.anexos ?? null,
    };
    const r = await autenticarAgente(pedido.headers.authorization, opcoesDaChave);
    if (!r.ok) {
      resposta.header("www-authenticate", 'Bearer realm="mago-os"');
      return resposta.code(r.status).send({
        jsonrpc: "2.0",
        error: { code: -32001, message: `Chave recusada: ${r.motivo}` },
        id: null,
      });
    }

    const servidor = criarServidor(r.agente, opcoesDaChave, pedido);
    const transporte = new StreamableHTTPServerTransport({
      // Sem sessionIdGenerator: modo sem sessão (cada pedido é independente).
      enableJsonResponse: true,
    });
    resposta.hijack();
    resposta.raw.on("close", () => {
      void transporte.close();
      void servidor.close();
    });
    // Depois do hijack, o Fastify não responde mais por nós: qualquer erro precisa virar resposta aqui.
    try {
      await servidor.connect(transporte);
      await transporte.handleRequest(pedido.raw, resposta.raw, pedido.body);
    } catch (erro) {
      pedido.log.error({ erro }, "MCP: erro ao atender o pedido");
      if (!resposta.raw.headersSent) {
        resposta.raw.writeHead(500, { "content-type": "application/json" });
        resposta.raw.end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno." }, id: null }),
        );
      } else {
        resposta.raw.end();
      }
    }
  });

  // Sem sessão no servidor: não há fluxo aberto (GET) nem sessão para encerrar (DELETE).
  const naoPermitido = async (_p: FastifyRequest, resposta: import("fastify").FastifyReply) =>
    resposta
      .code(405)
      .header("allow", "POST")
      .send({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Use POST: este servidor MCP não guarda sessão." },
        id: null,
      });
  app.get("/mcp", naoPermitido);
  app.delete("/mcp", naoPermitido);
}

function criarServidor(agente: AgenteDoPedido, o: OpcoesDaChave, pedido: FastifyRequest): Server {
  const servidor = new Server(
    { name: "mago-os", version: "0.2.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Mago OS: tarefas da empresa para agentes. Pergunte a cada minuto com minhas_tarefas, pegue antes de começar (pegar_tarefa), comente o andamento, entregue com entregar_resultado e solte (soltar_tarefa) se não souber fazer.",
    },
  );

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FERRAMENTAS_MCP.map((f) => ({
      name: f.nome,
      description: f.descricao,
      inputSchema: f.entrada as unknown as { type: "object" },
      outputSchema: f.saida as unknown as { type: "object" },
    })),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async (chamada) => {
    const ferramenta = FERRAMENTAS_MCP.find((f) => f.nome === chamada.params.name);
    if (!ferramenta) return erro(`Ferramenta desconhecida: ${chamada.params.name}`);
    const entrada = conferir(ferramenta.entrada, chamada.params.arguments ?? {});
    if (!entrada.ok) {
      return erro(
        `Entrada fora do formato: ${entrada.problemas.map((p) => `${p.caminho} ${p.mensagem}`).join("; ")}`,
      );
    }
    // O que o agente externo faz numa tarefa vira passo (M4-07), sem o raciocínio, que fica na máquina dele.
    const params = entrada.valor as Record<string, unknown>;
    const t0 = Date.now();
    // Só nas tarefas que o agente alcança: uma tentativa numa tarefa alheia não aparece na tarefa dos outros.
    const passo = (resultado: unknown, falhou: boolean, aprovacaoId: string | null = null) =>
      typeof params.tarefaId === "string"
        ? comEmpresa(o.poolApp, agente.empresaId, async (c) => {
            const alcanca = await buscarTarefa(
              c,
              { tipo: "agente", agenteId: agente.agenteId, comoGerente: true },
              params.tarefaId as string,
            );
            if (!alcanca) return;
            await registrarPasso(c, {
              execucaoId: null,
              agenteId: agente.agenteId,
              tarefaId: params.tarefaId as string,
              tipo: "ferramenta",
              ferramenta: ferramenta.nome,
              entrada: params,
              resultado,
              erro: falhou,
              duracaoMs: Date.now() - t0,
              aprovacaoId,
            });
          }).catch((e) => pedido.log.error({ erro: e }, "MCP: o passo não foi registrado"))
        : Promise.resolve();
    try {
      // Regra por ação (M4-03): para os externos, as ferramentas de hoje executam, mas o administrador pode mudar.
      const regra = await comEmpresa(o.poolApp, agente.empresaId, async (c) => {
        const avaliacao = await avaliarAcao(
          c,
          { id: agente.agenteId, tipo: "externo" },
          ferramenta.nome,
          params,
        );
        if (avaliacao !== "aprovacao") return { avaliacao };
        if (
          typeof params.tarefaId === "string" &&
          !(await buscarTarefa(
            c,
            { tipo: "agente", agenteId: agente.agenteId, comoGerente: true },
            params.tarefaId,
          ))
        )
          throw new RecusaDaFerramenta("Tarefa não encontrada entre as suas.");
        const r = await c.query<{ responsavel_id: string }>(
          "select responsavel_id from agentes where id = $1 and empresa_id = empresa_ativa()",
          [agente.agenteId],
        );
        const aprovacao = await criarAprovacao(c, {
          agenteId: agente.agenteId,
          execucaoId: null,
          pedidoPor: r.rows[0]?.responsavel_id as string,
          acao: ferramenta.nome,
          parametros: params,
          motivo: null,
        });
        return { avaliacao, aprovacao };
      });
      if (regra.avaliacao !== "executa") {
        await auditar(
          o.poolApp,
          {
            empresaId: agente.empresaId,
            ator: { tipo: "agente", agenteId: agente.agenteId },
            acao: regra.avaliacao === "bloqueado" ? "agente.bloqueado" : "agente.pediu_aprovacao",
            alvo:
              "aprovacao" in regra && regra.aprovacao
                ? { tipo: "aprovacao", id: regra.aprovacao.id }
                : { tipo: "agente", id: agente.agenteId },
            origem: o.origem,
            rastreio: o.rastreio ?? null,
            detalhes: { acao: ferramenta.nome },
          },
          pedido.log,
        );
        if (regra.avaliacao === "bloqueado") {
          const texto =
            "Essa ação está bloqueada pela regra da empresa para este agente. Peça a uma pessoa pela tela.";
          await passo(texto, true);
          return erro(texto);
        }
        const texto = `Essa ação precisa de aprovação. O pedido foi enviado (${"aprovacao" in regra && regra.aprovacao ? regra.aprovacao.resumo : ferramenta.nome}) e ela acontece quando alguém aprovar, em até 24 horas.`;
        // Sem o resultado da ferramenta (ela ainda não rodou): volta como recusa, com a explicação.
        // Esperando aprovação não é recusa: o passo mostra o pedido.
        await passo(texto, false, "aprovacao" in regra && regra.aprovacao ? regra.aprovacao.id : null);
        return erro(texto);
      }
      const resultado = await executar(ferramenta.nome, entrada.valor as never, agente, o, pedido);
      await passo(resultado, false);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resultado) }],
        structuredContent: resultado,
      };
    } catch (e) {
      if (e instanceof RecusaDaFerramenta) {
        await passo(e.message, true);
        return erro(e.message);
      }
      pedido.log.error({ erro: e, ferramenta: ferramenta.nome }, "MCP: erro na ferramenta");
      await passo("Não foi possível concluir agora.", true);
      return erro("Não foi possível concluir agora. Tente de novo em instantes.");
    }
  });
  return servidor;
}

/** A tarefa é do agente (responsável ou com a trava): só aí ele vê e baixa os anexos (decisão 2 da M3-08). */
function ehDoAgente(t: Tarefa, agenteId: string): boolean {
  return (
    (t.responsavel?.tipo === "agente" && t.responsavel.agenteId === agenteId) ||
    (t.trava?.por.tipo === "agente" && t.trava.por.agenteId === agenteId)
  );
}

function erro(texto: string) {
  return { content: [{ type: "text" as const, text: texto }], isError: true };
}

/**
 * Executa uma ferramenta na empresa do agente. Recusas viram RecusaDaFerramenta (texto para o agente). Os agentes
 * internos (M4-02) chamam esta mesma função para as ferramentas do MCP, com as mesmas regras.
 */
export async function executar(
  nome: NomeDaFerramenta,
  entrada: EntradaDa<NomeDaFerramenta>,
  agente: AgenteDoPedido,
  o: OpcoesDaChave,
  pedido: Pick<FastifyRequest, "log">,
): Promise<Record<string, unknown>> {
  const quem: Quem = { tipo: "agente", agenteId: agente.agenteId };
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(o.poolApp, agente.empresaId, trabalho);
  const registrar = async (acao: AcaoDeTarefa, tarefaId: string, detalhes: Record<string, unknown> = {}) => {
    // O que interessa a quem acompanha a tarefa entra também na linha do tempo (M3-05).
    const acontecimento = acontecimentoDaAcao(acao, detalhes);
    if (acontecimento) {
      await naEmpresa((c) =>
        registrarAcontecimento(
          c,
          tarefaId,
          { tipo: "agente", agenteId: agente.agenteId },
          acontecimento.tipo,
          acontecimento.detalhes,
        ),
      );
    }
    return auditar(
      o.poolApp,
      {
        empresaId: agente.empresaId,
        ator: { tipo: "agente", agenteId: agente.agenteId },
        acao,
        alvo: { tipo: "tarefa", id: tarefaId },
        origem: o.origem,
        rastreio: o.rastreio ?? null,
        detalhes,
      },
      pedido.log,
    );
  };
  const ler = async (quantos: number) => {
    if (!(await contarLeituras(agente, quantos, o))) {
      throw new RecusaDaFerramenta(
        "Você passou do limite de leitura por hora e foi pausado. A pessoa responsável foi avisada.",
      );
    }
  };
  const naoAchou = () => new RecusaDaFerramenta("Tarefa não encontrada entre as suas.");

  switch (nome) {
    case "minhas_tarefas": {
      const e = entrada as EntradaDa<"minhas_tarefas">;
      const tarefas = await naEmpresa((c) => listarTarefas(c, quem, { status: e.status ?? ABERTOS }));
      // A lista das próprias tarefas conta 1 leitura por chamada: o agente pergunta a cada minuto, e isso não pode
      // consumir o limite de leitura (pensado para conteúdo: tarefa aberta com comentários).
      await ler(1);
      const mencionado = await naEmpresa((c) => mencoesPendentes(c, agente.agenteId));
      return { tarefas, mencionado };
    }
    case "ver_tarefa": {
      const e = entrada as EntradaDa<"ver_tarefa">;
      const achou = await naEmpresa(async (c) => {
        // Só para ver: o gerente agente alcança as tarefas do projeto dele (M3-01), mas não mexe nas dos outros.
        const tarefa = await buscarTarefa(c, { ...quem, comoGerente: true }, e.tarefaId);
        if (!tarefa) return null;
        return {
          tarefa,
          // Nota interna não vai para os agentes (M3-05).
          comentarios: await listarComentarios(c, tarefa.id, false),
          subtarefas: await listarSubtarefas(c, tarefa.id),
          checklist: await listarChecklist(c, tarefa.id),
          // Os anexos só das tarefas dele (decisão 2 da M3-08), e só os já liberados pelo antivírus.
          anexos: ehDoAgente(tarefa, agente.agenteId)
            ? (await listarAnexos(c, tarefa.id, true)).map(semCaminho)
            : [],
        };
      });
      if (!achou) throw naoAchou();
      await ler(1 + achou.comentarios.length + achou.subtarefas.length);
      return achou;
    }
    case "pegar_tarefa": {
      const e = entrada as EntradaDa<"pegar_tarefa">;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await buscarTarefa(c, quem, e.tarefaId);
        if (!tarefa) return null;
        if (travadaPorQuem(tarefa, quem)) return { tarefa, jaEra: true };
        return { tarefa: await pegarTarefa(c, quem, tarefa.id), jaEra: false };
      });
      if (!feito) throw naoAchou();
      if (!feito.tarefa)
        throw new RecusaDaFerramenta("Essa tarefa já foi pegada por outro ou está encerrada.");
      if (!feito.jaEra) await registrar("tarefa.pegou", e.tarefaId);
      return feito.tarefa;
    }
    case "soltar_tarefa": {
      const e = entrada as EntradaDa<"soltar_tarefa">;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await buscarTarefa(c, quem, e.tarefaId, true);
        if (!tarefa) return null;
        if (!travadaPorQuem(tarefa, quem)) return { naoE: true as const };
        // O comentário vem antes, para a tarefa devolvida já trazer a última atualização.
        const comentario = e.motivo ? await comentar(c, autorDe(quem), tarefa.id, e.motivo) : null;
        let solta = await tirarTrava(c, tarefa.id);
        // Se era do agente, volta para a pessoa responsável por ele (senão ele a veria de novo no próximo minuto).
        if (solta.responsavel?.tipo === "agente" && solta.responsavel.agenteId === agente.agenteId) {
          const r = await c.query<{ responsavel_id: string }>(
            "select responsavel_id from agentes where id = $1 and empresa_id = empresa_ativa()",
            [agente.agenteId],
          );
          const pessoaId = r.rows[0]?.responsavel_id;
          const ativa = pessoaId ? await pessoaAtivaNaEmpresa(c, pessoaId) : false;
          solta = await trocarResponsavel(
            c,
            quem,
            solta,
            ativa && pessoaId ? { tipo: "pessoa", pessoaId } : null,
          );
        }
        return { tarefa: solta, comentario };
      });
      if (!feito) throw naoAchou();
      if ("naoE" in feito) throw new RecusaDaFerramenta("Você só solta uma tarefa que pegou.");
      if (feito.comentario)
        await registrar("tarefa.comentou", e.tarefaId, { comentarioId: feito.comentario.id });
      await registrar("tarefa.soltou", e.tarefaId);
      return feito.tarefa;
    }
    case "comentar": {
      const e = entrada as EntradaDa<"comentar">;
      const comentario = await naEmpresa(async (c) => {
        // Comenta onde vê: as tarefas dele, as do projeto que gerencia e as em que foi mencionado (M3-05).
        const tarefa = await buscarTarefa(c, { ...quem, comoGerente: true }, e.tarefaId, true);
        // As menções escritas no texto ("@Ana") avisam a pessoa, como as escolhidas na tela.
        return tarefa
          ? comentar(c, autorDe(quem), tarefa.id, e.texto, { mencoes: await mencoesDoTexto(c, e.texto) })
          : null;
      });
      if (!comentario) throw naoAchou();
      await registrar("tarefa.comentou", e.tarefaId, { comentarioId: comentario.id });
      if (comentario.mencoes.length > 0)
        await registrar("tarefa.mencionou", e.tarefaId, {
          comentarioId: comentario.id,
          pessoas: comentario.mencoes.length,
          agentes: 0,
        });
      const comentada = await naEmpresa((c) => buscarTarefa(c, { ...quem, comoGerente: true }, e.tarefaId));
      if (comentada) {
        await avisarDepois(
          o.poolApp,
          agente.empresaId,
          { tipo: "agente", agenteId: agente.agenteId },
          { tipo: "comentou", tarefa: comentada, comentario },
          pedido.log,
        );
      }
      return comentario;
    }
    case "mudar_status":
    case "entregar_resultado": {
      const e = entrada as EntradaDa<"mudar_status"> & Partial<EntradaDa<"entregar_resultado">>;
      const status: StatusTarefa =
        nome === "entregar_resultado" ? "concluida" : (e as EntradaDa<"mudar_status">).status;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await buscarTarefa(c, quem, e.tarefaId, true);
        if (!tarefa) return null;
        if (!travadaPorQuem(tarefa, quem)) return { naoE: true as const };
        const de = tarefa.status;
        const motivo = (e as { motivo?: string }).motivo;
        const comentario = motivo ? await comentar(c, autorDe(quem), tarefa.id, motivo) : null;
        // Mesmo status sem resultado: nada muda (como na tela).
        const mudou = status !== de || e.resultado !== undefined;
        const nova = mudou ? await mudarStatus(c, quem, tarefa, status, e.resultado ?? null) : tarefa;
        // Entregou uma recorrente: nasce a próxima (M3-03).
        const proxima = mudou && de !== "concluida" ? await recorrerSePreciso(c, nova) : null;
        return { tarefa: nova, de, comentario, mudou, proxima };
      });
      if (!feito) throw naoAchou();
      if ("naoE" in feito)
        throw new RecusaDaFerramenta("Pegue a tarefa (pegar_tarefa) antes de mudar o status ou entregar.");
      if (feito.comentario)
        await registrar("tarefa.comentou", e.tarefaId, { comentarioId: feito.comentario.id });
      if (feito.mudou) {
        await registrar("tarefa.mudou_status", e.tarefaId, {
          de: feito.de,
          para: feito.tarefa.status,
          comResultado: feito.tarefa.resultado !== null,
        });
      }
      if (feito.proxima) {
        await registrar("tarefa.recorreu", e.tarefaId, {
          proximaId: feito.proxima,
          ocorrencia: feito.tarefa.ocorrencia + 1,
        });
        // A próxima nasce do sistema: com um agente interno de responsável, ele trabalha em nome do responsável dele.
        await entregarAoAgenteInterno(o.poolApp, agente.empresaId, { tipo: "sistema" }, feito.proxima).catch(
          (erro) => pedido.log.error({ erro }, "Tarefa do agente interno: não entrou na fila"),
        );
      }
      if (feito.mudou) {
        await avisarDepois(
          o.poolApp,
          agente.empresaId,
          { tipo: "agente", agenteId: agente.agenteId },
          { tipo: "mudou_status", tarefa: feito.tarefa, de: feito.de },
          pedido.log,
        );
      }
      return feito.tarefa;
    }
    case "criar_subtarefa": {
      // M3-02: o agente divide o trabalho da tarefa que pegou em passos. Sem responsável, a subtarefa é dele.
      const e = entrada as EntradaDa<"criar_subtarefa">;
      const responsavel = e.responsavel ?? { tipo: "agente" as const, agenteId: agente.agenteId };
      const feito = await naEmpresa(async (c) => {
        const mae = await buscarTarefa(c, quem, e.tarefaId, true);
        if (!mae) return null;
        if (!travadaPorQuem(mae, quem))
          return { recusa: "Pegue a tarefa (pegar_tarefa) antes de criar subtarefas." };
        if (mae.tarefaMaeId !== null)
          return { recusa: "Esta já é uma subtarefa: subtarefa não tem subtarefas." };
        const valido =
          responsavel.tipo === "agente"
            ? await agenteRecebeTarefas(c, responsavel.agenteId)
            : await pessoaAtivaNaEmpresa(c, responsavel.pessoaId);
        if (!valido) return { recusa: "Esse responsável não está ativo nesta empresa." };
        return {
          tarefa: await criarTarefa(c, quem, {
            titulo: e.titulo,
            descricao: e.descricao ?? null,
            responsavel,
            tarefaMaeId: mae.id,
          }),
        };
      });
      if (!feito) throw naoAchou();
      if ("recusa" in feito) throw new RecusaDaFerramenta(feito.recusa);
      await registrar("tarefa.criou", feito.tarefa.id, {
        responsavel: responsavel.tipo,
        tarefaMaeId: e.tarefaId,
      });
      await registrar("tarefa.criou_subtarefa", e.tarefaId, { subtarefaId: feito.tarefa.id });
      // Para um agente interno: vira trabalho dele (M4-04); de um agente externo, em nome do responsável por ele.
      if (responsavel.tipo === "agente")
        await entregarAoAgenteInterno(
          o.poolApp,
          agente.empresaId,
          { tipo: "agente", agenteId: agente.agenteId },
          feito.tarefa.id,
        ).catch((erro) => pedido.log.error({ erro }, "Tarefa do agente interno: não entrou na fila"));
      return feito.tarefa;
    }
    case "marcar_checklist": {
      const e = entrada as EntradaDa<"marcar_checklist">;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await buscarTarefa(c, quem, e.tarefaId, true);
        if (!tarefa) return null;
        if (!travadaPorQuem(tarefa, quem))
          return { recusa: "Pegue a tarefa (pegar_tarefa) antes de marcar o checklist." };
        const item = await buscarItem(c, tarefa.id, e.itemId);
        if (!item) return { recusa: "Esse item não é do checklist desta tarefa." };
        return {
          antes: item.marcado,
          item: await editarItem(c, item, { marcado: e.marcado }, autorDe(quem)),
        };
      });
      if (!feito) throw naoAchou();
      if ("recusa" in feito) throw new RecusaDaFerramenta(feito.recusa);
      if (feito.antes !== feito.item.marcado) {
        await registrar("checklist.marcou", e.tarefaId, { itemId: e.itemId, marcado: feito.item.marcado });
      }
      return feito.item;
    }
    case "baixar_anexo": {
      const e = entrada as EntradaDa<"baixar_anexo">;
      const deposito = o.anexos?.deposito;
      if (!deposito) throw new RecusaDaFerramenta("Os anexos ainda não estão ligados neste ambiente.");
      const anexo = await naEmpresa(async (c) => {
        if (!(await buscarTarefa(c, quem, e.tarefaId))) return null;
        return buscarAnexo(c, e.tarefaId, e.anexoId, { paraAgente: true });
      });
      if (!anexo) throw naoAchou();
      if (anexo.situacao !== "disponivel")
        throw new RecusaDaFerramenta("Esse anexo ainda não foi liberado pelo antivírus.");
      const link = deposito.linkDeDownload(
        anexo.caminho,
        anexo.nome,
        anexo.tipo,
        MINUTOS_DO_LINK_DE_ANEXO * 60,
      );
      await auditar(
        o.poolApp,
        {
          empresaId: agente.empresaId,
          ator: { tipo: "agente", agenteId: agente.agenteId },
          acao: "anexo.baixou",
          alvo: { tipo: "tarefa", id: e.tarefaId },
          origem: o.origem,
          rastreio: o.rastreio ?? null,
          detalhes: { anexoId: anexo.id },
        },
        o.log,
      );
      return { url: link.url, expiraEm: link.expiraEm.toISOString() };
    }
    case "estou_vivo":
      // A conferência da chave já registrou o sinal de vida.
      return { ok: true, agora: new Date().toISOString() };
    case "pegar_instrucoes": {
      // M4-05: as camadas juntadas; a do projeto só vem se o agente alcança a tarefa.
      const e = entrada as EntradaDa<"pegar_instrucoes">;
      return naEmpresa(async (c) => {
        const tarefa = e.tarefaId ? await buscarTarefa(c, { ...quem, comoGerente: true }, e.tarefaId) : null;
        if (e.tarefaId && !tarefa) throw naoAchou();
        return montarInstrucoes(c, agente.agenteId, tarefa?.id ?? null);
      });
    }
    case "listar_skills": {
      const skills = await naEmpresa((c) => skillsDoAgente(c, agente.agenteId));
      return { skills: skills.map(({ texto: _, ...s }) => s) };
    }
    case "pegar_skill": {
      const e = entrada as EntradaDa<"pegar_skill">;
      const skill = (await naEmpresa((c) => skillsDoAgente(c, agente.agenteId))).find(
        (s) => s.id === e.skillId,
      );
      if (!skill) throw new RecusaDaFerramenta("Essa skill não está atribuída a você.");
      return skill;
    }
  }
}
