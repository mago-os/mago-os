/**
 * API pública (M7-02, decisão 0047): os endereços /v1 (em app.osmago.com/api/v1), as chaves de API da empresa (tela
 * Configurações › API) e a documentação pública (/docs e /openapi.json).
 *
 * Cada endereço /v1 vem do contrato (ROTAS_DA_API_PUBLICA) e é atendido pela mesma rota da tela, com a pessoa da chave
 * (chave mago_api_), ou pelo mesmo servidor MCP, com o agente (chave mago_ag_), por um pedido interno com o bilhete da
 * ponte. Assim vale a mesma permissão, o mesmo alcance, as mesmas regras dos agentes e a mesma auditoria, com o canal
 * "api".
 */
import {
  ACESSOS_DA_API,
  type AcaoDaApi,
  conferirPedidoDeChaveDeApi,
  FORMATO_DA_CHAVE,
  FORMATO_DA_CHAVE_DE_API,
  type MotivoDeRecusa,
  type MotivoDeRecusaDaApi,
  type Problema,
  ROTAS_DA_API_PUBLICA,
  type RotaDaApiPublica,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  autenticarChaveDeApi,
  buscarChaveDeApi,
  criarChaveDeApi,
  listarChavesDeApi,
  RecusaDaChaveDeApi,
  registrarRecusa,
  revogarChaveDeApi,
  trocarChaveDeApi,
} from "./chaves.ts";
import { documentoOpenApi, paginaDaDocumentacao } from "./documentacao.ts";
import { CABECALHO_DA_PONTE, comBilhete } from "./ponte.ts";

export interface OpcoesDaApiPublica {
  verificador: Verificador;
  poolApp: pg.Pool;
  urlPublica: string;
  /** Os testes usam limites pequenos. */
  limites?: { pedidosPorMinutoPorChave: number; pedidosPorMinutoPorEmpresa: number };
}

const RECUSAS: Record<MotivoDeRecusaDaApi | MotivoDeRecusa, string> = {
  formato: "Mande a chave no cabeçalho Authorization: Bearer mago_api_... (ou a chave do agente).",
  desconhecida: "Chave desconhecida.",
  revogada: "Essa chave foi revogada.",
  vencida: "Essa chave venceu. Peça uma nova ao administrador.",
  ip: "Essa chave não pode ser usada deste endereço IP.",
  fora_do_escopo: "Essa chave não alcança este módulo (ou só lê).",
  sem_permissao: "A pessoa da chave não pode fazer isso.",
  canal: "Este agente não pode usar a API pública (o administrador deixou só o MCP).",
  passou_do_limite: "Muitos pedidos por minuto. Espere um pouco e tente de novo.",
  agente_pausado: "O agente está pausado.",
  agente_desligado: "O agente foi desligado.",
};

const CODIGOS: Partial<Record<MotivoDeRecusaDaApi | MotivoDeRecusa, string>> = {
  fora_do_escopo: "FORA_DO_ESCOPO",
  passou_do_limite: "LIMITE",
  ip: "IP_NAO_PERMITIDO",
  canal: "CANAL_FECHADO",
};

function recusar(resposta: FastifyReply, motivo: MotivoDeRecusaDaApi | MotivoDeRecusa, status: number) {
  if (status === 429) resposta.header("retry-after", "60");
  if (status === 401) resposta.header("www-authenticate", 'Bearer realm="mago-os"');
  return resposta.code(status).send({ code: CODIGOS[motivo] ?? "CHAVE_RECUSADA", message: RECUSAS[motivo] });
}

/** O caminho da rota (/v1/tarefas/{id}) com os parâmetros, no formato do Fastify (/v1/tarefas/:id). */
const paraFastify = (caminho: string) => caminho.replace(/\{(\w+)\}/g, ":$1");

/** Valores de uma query (a,b ou repetida) como lista. */
function lista(valor: unknown): string[] {
  return [valor ?? []]
    .flat()
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A query da API (nomes do contrato) para a da rota da tela. */
function queryInterna(q: Record<string, unknown>, renomear: Record<string, string>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const valores = lista(v);
    if (valores.length > 0) s.set(renomear[k] ?? k, valores.join(","));
  }
  const t = s.toString();
  return t ? `?${t}` : "";
}

const RENOMEAR_TAREFAS = {
  projetoId: "projeto",
  espacoId: "espaco",
  contatoId: "contato",
  deAgente: "agente",
};
const RENOMEAR_CONTATOS = { organizacaoId: "organizacao" };

interface Traducao {
  metodo: "GET" | "POST";
  url: string;
  corpo?: unknown;
  /** O que tirar da resposta da tela para virar a resposta da API. */
  saida?: (corpo: Record<string, unknown>) => unknown;
}

/** Para cada endereço /v1, a rota da tela que atende a pessoa da chave. */
function paraTela(rota: RotaDaApiPublica, id: string, q: Record<string, unknown>, corpo: unknown): Traducao {
  switch (rota.id) {
    case "listarTarefas":
      return {
        metodo: "GET",
        url: `/tarefas${queryInterna(q, RENOMEAR_TAREFAS)}`,
        saida: (b) => ({ tarefas: b.tarefas }),
      };
    case "verTarefa":
      return { metodo: "GET", url: `/tarefas/${id}`, saida: (b) => b.tarefa };
    case "criarTarefa":
      return { metodo: "POST", url: "/tarefas", corpo };
    case "mudarStatusDaTarefa":
      return { metodo: "POST", url: `/tarefas/${id}/status`, corpo };
    case "listarComentarios":
      return {
        metodo: "GET",
        url: `/tarefas/${id}`,
        saida: (b) => ({
          comentarios: ((b.comentarios as { tipo: string }[] | undefined) ?? []).filter(
            (c) => c.tipo === "comentario",
          ),
        }),
      };
    case "comentar":
      return { metodo: "POST", url: `/tarefas/${id}/comentarios`, corpo };
    case "ligarContatosATarefa":
      return {
        metodo: "POST",
        url: `/tarefas/${id}/contatos`,
        corpo,
        saida: (b) => ({ contatos: b.contatos }),
      };
    case "listarProjetos":
      return { metodo: "GET", url: "/projetos", saida: (b) => ({ projetos: b.projetos }) };
    case "verProjeto":
      return { metodo: "GET", url: `/projetos/${id}`, saida: (b) => b.projeto };
    case "listarContatos":
      return {
        metodo: "GET",
        url: `/contatos${queryInterna(q, RENOMEAR_CONTATOS)}`,
        saida: (b) => ({ contatos: b.contatos }),
      };
    case "verContato":
      return { metodo: "GET", url: `/contatos/${id}`, saida: (b) => b.contato ?? b };
    case "criarContato":
      return { metodo: "POST", url: "/contatos", corpo };
    case "editarContato":
      return { metodo: "POST", url: `/contatos/${id}`, corpo };
    case "listarAgentes":
      return { metodo: "GET", url: "/agentes", saida: (b) => ({ agentes: b }) };
    default:
      throw new Error(`Rota da API sem tradução: ${rota.id}`);
  }
}

/** Para o agente (chave mago_ag_), a ferramenta do MCP que atende cada endereço; nulo: não existe para agentes. */
function paraMcp(
  rota: RotaDaApiPublica,
  id: string,
  q: Record<string, unknown>,
  corpo: Record<string, unknown>,
): {
  ferramenta: string;
  args: Record<string, unknown>;
  saida?: (r: Record<string, unknown>) => unknown;
} | null {
  switch (rota.id) {
    case "listarTarefas": {
      const status = lista(q.status);
      return {
        ferramenta: "minhas_tarefas",
        args: status.length > 0 ? { status } : {},
        saida: (r) => ({ tarefas: r.tarefas }),
      };
    }
    case "verTarefa":
      return { ferramenta: "ver_tarefa", args: { tarefaId: id }, saida: (r) => r.tarefa };
    case "listarComentarios":
      return {
        ferramenta: "ver_tarefa",
        args: { tarefaId: id },
        saida: (r) => ({ comentarios: r.comentarios }),
      };
    case "mudarStatusDaTarefa":
      return corpo.status === "concluida"
        ? {
            ferramenta: "entregar_resultado",
            args: { tarefaId: id, resultado: corpo.resultado ?? "Concluída." },
          }
        : {
            ferramenta: "mudar_status",
            args: { tarefaId: id, status: corpo.status, ...(corpo.motivo ? { motivo: corpo.motivo } : {}) },
          };
    case "comentar":
      return { ferramenta: "comentar", args: { tarefaId: id, texto: corpo.texto } };
    case "ligarContatosATarefa":
      return { ferramenta: "ligar_contato", args: { tarefaId: id, contatos: corpo.contatos } };
    case "listarContatos": {
      const filtro: Record<string, unknown> = {};
      for (const k of ["tipo", "organizacaoId", "situacao", "texto"])
        if (typeof q[k] === "string" && q[k]) filtro[k] = q[k];
      for (const k of ["papeis", "etiquetas", "responsaveis"])
        if (lista(q[k]).length > 0) filtro[k] = lista(q[k]);
      return { ferramenta: "listar_contatos", args: filtro, saida: (r) => ({ contatos: r.contatos }) };
    }
    case "verContato":
      return { ferramenta: "ver_contato", args: { contatoId: id }, saida: (r) => r.contato };
    case "criarContato":
      return { ferramenta: "criar_contato", args: corpo };
    case "editarContato":
      return { ferramenta: "atualizar_contato", args: { contatoId: id, mudancas: corpo } };
    default:
      return null;
  }
}

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

export function registrarApiPublica(app: FastifyInstance, o: OpcoesDaApiPublica): void {
  const { verificador, poolApp } = o;

  // Documentação pública, sem nenhum dado.
  app.get("/openapi.json", async () => documentoOpenApi(o.urlPublica));
  app.get("/docs", async (_pedido, resposta) =>
    resposta.type("text/html; charset=utf-8").send(paginaDaDocumentacao(o.urlPublica)),
  );

  for (const rota of ROTAS_DA_API_PUBLICA) {
    app.route({
      method: rota.metodo,
      url: paraFastify(rota.caminho),
      handler: async (pedido, resposta) => {
        const chave = /^Bearer\s+(\S+)$/i.exec(pedido.headers.authorization ?? "")?.[1] ?? "";
        const id = (pedido.params as { id?: string }).id ?? "";
        if (id && !/^[0-9a-f-]{36}$/i.test(id))
          return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Não encontrado." });
        const q = (pedido.query ?? {}) as Record<string, unknown>;
        const corpo = (pedido.body ?? {}) as Record<string, unknown>;
        const origem = { ...origemDoPedido(pedido), canal: "api" as const };
        const repassar = {
          "user-agent": String(pedido.headers["user-agent"] ?? "API do Mago OS"),
          ...(origem.ip ? { "x-forwarded-for": origem.ip } : {}),
        };

        // Chave de agente: o mesmo servidor MCP, pelo canal "api".
        if (FORMATO_DA_CHAVE.test(chave)) {
          const mcp = paraMcp(rota, id, q, corpo);
          if (!mcp)
            return resposta.code(403).send({
              code: "NAO_PARA_AGENTES",
              message:
                "Esse endereço não está disponível para a chave de agente. Use uma chave de API da empresa.",
            });
          const feito = await comBilhete(
            { tipo: "agente", empresaId: "", pessoaId: null, chaveId: "" },
            (bilhete) =>
              app.inject({
                method: "POST",
                url: "/mcp",
                headers: {
                  ...repassar,
                  authorization: `Bearer ${chave}`,
                  accept: "application/json, text/event-stream",
                  "content-type": "application/json",
                  [CABECALHO_DA_PONTE]: bilhete,
                },
                payload: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "tools/call",
                  params: { name: mcp.ferramenta, arguments: mcp.args },
                }),
              }),
          );
          const corpoMcp = feito.json() as {
            error?: { message: string };
            result?: {
              isError?: boolean;
              structuredContent?: Record<string, unknown>;
              content?: { text: string }[];
            };
          };
          if (feito.statusCode >= 400 || corpoMcp.error) {
            const motivo = /Chave recusada: (\w+)/.exec(corpoMcp.error?.message ?? "")?.[1] as MotivoDeRecusa;
            return recusar(
              resposta,
              RECUSAS[motivo] ? motivo : "desconhecida",
              feito.statusCode >= 400 ? feito.statusCode : 401,
            );
          }
          if (corpoMcp.result?.isError)
            return resposta
              .code(400)
              .send({ code: "RECUSADO", message: corpoMcp.result.content?.[0]?.text ?? "Pedido recusado." });
          const resultado = corpoMcp.result?.structuredContent ?? {};
          return mcp.saida ? mcp.saida(resultado) : resultado;
        }

        // Chave de API da empresa: a rota da tela, em nome da pessoa da chave.
        if (!FORMATO_DA_CHAVE_DE_API.test(chave)) return recusar(resposta, "formato", 401);
        const r = await autenticarChaveDeApi(chave, {
          poolApp,
          log: pedido.log,
          origem,
          rastreio: pedido.id,
          ...(o.limites ? { limites: o.limites } : {}),
        });
        if (!r.ok) return recusar(resposta, r.motivo, r.status);
        const acesso = r.chave.escopo[rota.modulo];
        const alcanca = acesso && ACESSOS_DA_API.indexOf(acesso) >= ACESSOS_DA_API.indexOf(rota.precisa);
        if (!alcanca) {
          await registrarRecusa(
            { poolApp, log: pedido.log, origem, rastreio: pedido.id },
            r.chave,
            "fora_do_escopo",
            {
              rota: rota.id,
            },
          );
          return recusar(resposta, "fora_do_escopo", 403);
        }
        const traducao = paraTela(rota, id, q, corpo);
        const feito = await comBilhete(
          {
            tipo: "pessoa",
            empresaId: r.chave.empresaId,
            pessoaId: r.chave.pessoaId,
            chaveId: r.chave.chaveId,
          },
          (bilhete) =>
            app.inject({
              method: traducao.metodo,
              url: traducao.url,
              headers: {
                ...repassar,
                [CABECALHO_DA_PONTE]: bilhete,
                ...(traducao.metodo === "POST" ? { "content-type": "application/json" } : {}),
              },
              ...(traducao.metodo === "POST" ? { payload: JSON.stringify(traducao.corpo ?? {}) } : {}),
            }),
        );
        const dados = feito.body ? (feito.json() as Record<string, unknown>) : {};
        if (feito.statusCode >= 400) {
          if (feito.statusCode === 403) {
            await registrarRecusa(
              { poolApp, log: pedido.log, origem, rastreio: pedido.id },
              r.chave,
              "sem_permissao",
              {
                rota: rota.id,
              },
            );
            return recusar(resposta, "sem_permissao", 403);
          }
          return resposta.code(feito.statusCode).send(dados);
        }
        if (rota.id === "verContato" && typeof dados.juntadoEmId === "string")
          return resposta
            .code(404)
            .send({ code: "JUNTADO", message: `Esse contato foi juntado no contato ${dados.juntadoEmId}.` });
        return resposta.code(feito.statusCode).send(traducao.saida ? traducao.saida(dados) : dados);
      },
    });
  }

  // As chaves de API da empresa (Configurações › API) ---------------------------------------------------------------

  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const registrar = (pedido: FastifyRequest, acao: AcaoDaApi, chaveId: string, detalhes = {}) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "chave_de_api", id: chaveId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  };
  // Só o administrador (alcance "tudo"): a chave age em nome de qualquer pessoa da empresa.
  const soTudo = (pedido: FastifyRequest, resposta: FastifyReply) => {
    if (acessoDo(pedido).alcance === "tudo") return true;
    resposta
      .code(403)
      .send({ code: "SEM_PERMISSAO", message: "Só o administrador cuida das chaves de API." });
    return false;
  };

  app.get(
    "/empresa/chaves-de-api",
    { preHandler: verificador.exigir("api", "ver") },
    async (pedido, resposta) => {
      if (!soTudo(pedido, resposta)) return resposta;
      return naEmpresa(pedido, async (c) => ({ chaves: await listarChavesDeApi(c) }));
    },
  );

  app.post(
    "/empresa/chaves-de-api",
    { preHandler: verificador.exigir("api", "criar") },
    async (pedido, resposta) => {
      if (!soTudo(pedido, resposta)) return resposta;
      const r = conferirPedidoDeChaveDeApi(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      try {
        const feito = await naEmpresa(pedido, (c) =>
          criarChaveDeApi(c, {
            nome: r.valor.nome,
            escopo: r.valor.escopo,
            pessoaId: r.valor.pessoaId ?? sessao.pessoa.id,
            ips: r.valor.ips ?? [],
            validaAte: r.valor.validaAte ?? null,
            criadaPor: sessao.pessoa.id,
          }),
        );
        await registrar(pedido, "chave_api.criou", feito.chave.id, {
          prefixo: feito.chave.prefixo,
          pessoaId: feito.chave.pessoaId,
          escopo: feito.chave.escopo,
          ips: feito.chave.ips.length,
        });
        return resposta.code(201).send(feito);
      } catch (erro) {
        if (erro instanceof RecusaDaChaveDeApi)
          return resposta.code(400).send({ code: "CHAVE_RECUSADA", message: erro.message });
        throw erro;
      }
    },
  );

  app.post(
    "/empresa/chaves-de-api/:id/trocar",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!soTudo(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          const antiga = await buscarChaveDeApi(c, id, true);
          return antiga ? trocarChaveDeApi(c, antiga, sessao.pessoa.id) : null;
        });
        if (!feito)
          return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Chave não encontrada." });
        await registrar(pedido, "chave_api.trocou", id, {
          novaId: feito.chave.id,
          prefixo: feito.chave.prefixo,
        });
        return resposta.code(201).send(feito);
      } catch (erro) {
        if (erro instanceof RecusaDaChaveDeApi)
          return resposta.code(400).send({ code: "CHAVE_RECUSADA", message: erro.message });
        throw erro;
      }
    },
  );

  app.post(
    "/empresa/chaves-de-api/:id/revogar",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!soTudo(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, (c) => revogarChaveDeApi(c, id, sessao.pessoa.id));
      if (!feito)
        return resposta
          .code(404)
          .send({ code: "NAO_ENCONTRADA", message: "Chave não encontrada ou já revogada." });
      await registrar(pedido, "chave_api.revogou", id);
      return { ok: true };
    },
  );
}
