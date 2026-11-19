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
  type ACOES_TAREFAS,
  conferir,
  type EntradaDa,
  FERRAMENTAS_MCP,
  type NomeDaFerramenta,
  type StatusTarefa,
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
import { auditar } from "../auditoria/registrar.ts";
import { comEmpresa } from "../empresa.ts";
import {
  autorDe,
  buscarTarefa,
  comentar,
  listarComentarios,
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
}

/** Recusa que o agente lê (vira isError na resposta da ferramenta). */
class RecusaDaFerramenta extends Error {
  override name = "RecusaDaFerramenta";
}

type AcaoDeTarefa = (typeof ACOES_TAREFAS)[number];

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
    try {
      const resultado = await executar(ferramenta.nome, entrada.valor as never, agente, o, pedido);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resultado) }],
        structuredContent: resultado,
      };
    } catch (e) {
      if (e instanceof RecusaDaFerramenta) return erro(e.message);
      pedido.log.error({ erro: e, ferramenta: ferramenta.nome }, "MCP: erro na ferramenta");
      return erro("Não foi possível concluir agora. Tente de novo em instantes.");
    }
  });
  return servidor;
}

function erro(texto: string) {
  return { content: [{ type: "text" as const, text: texto }], isError: true };
}

/** Executa uma ferramenta na empresa do agente. Recusas viram RecusaDaFerramenta (texto para o agente). */
async function executar(
  nome: NomeDaFerramenta,
  entrada: EntradaDa<NomeDaFerramenta>,
  agente: AgenteDoPedido,
  o: OpcoesDaChave,
  pedido: FastifyRequest,
): Promise<Record<string, unknown>> {
  const quem: Quem = { tipo: "agente", agenteId: agente.agenteId };
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(o.poolApp, agente.empresaId, trabalho);
  const registrar = (acao: AcaoDeTarefa, tarefaId: string, detalhes: Record<string, unknown> = {}) =>
    auditar(
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
      return { tarefas };
    }
    case "ver_tarefa": {
      const e = entrada as EntradaDa<"ver_tarefa">;
      const achou = await naEmpresa(async (c) => {
        // Só para ver: o gerente agente alcança as tarefas do projeto dele (M3-01), mas não mexe nas dos outros.
        const tarefa = await buscarTarefa(c, { ...quem, comoGerente: true }, e.tarefaId);
        return tarefa ? { tarefa, comentarios: await listarComentarios(c, tarefa.id) } : null;
      });
      if (!achou) throw naoAchou();
      await ler(1 + achou.comentarios.length);
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
        const tarefa = await buscarTarefa(c, quem, e.tarefaId, true);
        return tarefa ? comentar(c, autorDe(quem), tarefa.id, e.texto) : null;
      });
      if (!comentario) throw naoAchou();
      await registrar("tarefa.comentou", e.tarefaId, { comentarioId: comentario.id });
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
        return { tarefa: nova, de, comentario, mudou };
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
      return feito.tarefa;
    }
    case "estou_vivo":
      // A conferência da chave já registrou o sinal de vida.
      return { ok: true, agora: new Date().toISOString() };
  }
}
