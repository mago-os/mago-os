/**
 * Rotas dos anexos (M3-08). Quem vê a tarefa vê e baixa; quem edita a tarefa anexa nela; quem escreveu o comentário
 * anexa nele; exclui quem enviou ou quem exclui qualquer tarefa (decisão 1 da M3-08).
 */
import {
  conferir,
  extensaoBloqueada,
  MINUTOS_DO_LINK_DE_ANEXO,
  PedidoDeEnvioDeAnexo,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { buscarComentario, buscarTarefa, type Quem } from "../tarefas/servico.ts";
import { type DepositoEmDisco, disposicao, podeVerNaTela } from "./deposito.ts";
import {
  buscarAnexo,
  criarAnexo,
  espacoDaEmpresa,
  excluirAnexo,
  listarAnexos,
  marcarVerificando,
  type ServicosDosAnexos,
  semCaminho,
} from "./servico.ts";

const SEGUNDOS = MINUTOS_DO_LINK_DE_ANEXO * 60;

export interface OpcoesDosAnexos {
  verificador: Verificador;
  poolApp: pg.Pool;
  /** Nulo quando os anexos estão desligados (sem depósito configurado fora do Mac). */
  servicos: ServicosDosAnexos | null;
  /** Chama a fila na hora, para o antivírus não esperar o próximo minuto. */
  acordarFila: () => void;
}

/** Quem pede, com o alcance de uma ação em tarefas (ver ou editar). */
function quemPara(pedido: FastifyRequest, acao: "ver" | "editar"): Extract<Quem, { tipo: "pessoa" }> | null {
  const { sessao, permissoes } = acessoDo(pedido);
  const tarefas = permissoes.modulos.get("tarefas");
  const filtro = filtroDoAlcance(tarefas?.acoes[acao] ?? "nada", sessao.pessoa.id, permissoes.area);
  if (!filtro) return null;
  const verProjetos = permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
  const projetos =
    verProjetos === "nada" ? "nenhum" : acao === "ver" && verProjetos === "tudo" ? "todos" : "membro";
  return { tipo: "pessoa", pessoaId: sessao.pessoa.id, filtro, projetos };
}

export function registrarRotasDosAnexos(app: FastifyInstance, o: OpcoesDosAnexos): void {
  const { verificador, poolApp } = o;
  const ver = { preHandler: verificador.exigir("tarefas", "ver") };

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  const naoEncontrado = (resposta: FastifyReply) =>
    resposta.code(404).send({ code: "ANEXO_NAO_ENCONTRADO", message: "Anexo não encontrado." });
  const desligados = (resposta: FastifyReply) =>
    resposta
      .code(503)
      .send({ code: "ANEXOS_DESLIGADOS", message: "Os anexos ainda não estão ligados neste ambiente." });

  function registrar(
    pedido: FastifyRequest,
    acao: string,
    tarefaId: string,
    detalhes: Record<string, unknown>,
  ) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "tarefa", id: tarefaId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }

  app.get("/tarefas/:id/anexos", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const quem = quemPara(pedido, "ver");
    const anexos = await naEmpresa(pedido, async (c) => {
      if (!quem || !(await buscarTarefa(c, quem, id))) return null;
      return (await listarAnexos(c, id)).map(semCaminho);
    });
    if (!anexos)
      return resposta.code(404).send({ code: "TAREFA_NAO_ENCONTRADA", message: "Tarefa não encontrada." });
    return { anexos, ligados: o.servicos !== null };
  });

  // Pede o link para enviar: confere permissão, tipo e tamanho, cria o anexo em "enviando".
  app.post("/tarefas/:id/anexos", ver, async (pedido, resposta) => {
    if (!o.servicos) return desligados(resposta);
    const servicos = o.servicos;
    const { id } = pedido.params as { id: string };
    const r = conferir(PedidoDeEnvioDeAnexo, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    if (extensaoBloqueada(r.valor.nome)) {
      return resposta.code(400).send({
        code: "TIPO_BLOQUEADO",
        message: "Esse tipo de arquivo não pode ser anexado, porque pode rodar um programa.",
      });
    }
    const comentarioId = r.valor.comentarioId ?? null;
    const { sessao } = acessoDo(pedido);
    // Na tarefa: quem pode editar. No comentário: quem o escreveu (e vê a tarefa).
    const quem = quemPara(pedido, comentarioId ? "ver" : "editar");
    const feito = await naEmpresa(pedido, async (c) => {
      if (!quem || !(await buscarTarefa(c, quem, id))) return null;
      if (comentarioId) {
        const cm = await buscarComentario(c, id, comentarioId);
        if (!cm || cm.apagadoEm || cm.autor.tipo !== "pessoa" || cm.autor.pessoaId !== sessao.pessoa.id)
          return { recusa: "Só quem escreveu o comentário anexa nele." };
      }
      return {
        anexo: await criarAnexo(c, {
          tarefaId: id,
          comentarioId,
          nome: r.valor.nome,
          tipo: r.valor.tipo,
          tamanho: r.valor.tamanho,
          pessoaId: sessao.pessoa.id,
        }),
      };
    });
    if (!feito)
      return resposta.code(404).send({
        code: "TAREFA_NAO_ENCONTRADA",
        message: "Tarefa não encontrada ou sem permissão para anexar.",
      });
    if ("recusa" in feito) return resposta.code(403).send({ code: "SEM_PERMISSAO", message: feito.recusa });
    const link = servicos.deposito.linkDeEnvio(
      feito.anexo.caminho,
      feito.anexo.tipo,
      feito.anexo.tamanho,
      SEGUNDOS,
    );
    return resposta
      .code(201)
      .send({ anexo: semCaminho(feito.anexo), url: link.url, expiraEm: link.expiraEm.toISOString() });
  });

  // O navegador terminou de enviar: confere que o arquivo chegou inteiro e manda para o antivírus.
  app.post("/tarefas/:id/anexos/:anexoId/enviado", ver, async (pedido, resposta) => {
    if (!o.servicos) return desligados(resposta);
    const servicos = o.servicos;
    const { id, anexoId } = pedido.params as { id: string; anexoId: string };
    const { sessao } = acessoDo(pedido);
    const anexo = await naEmpresa(pedido, (c) => buscarAnexo(c, id, anexoId));
    if (anexo?.enviadoPor.tipo !== "pessoa" || anexo.enviadoPor.pessoaId !== sessao.pessoa.id)
      return naoEncontrado(resposta);
    if (anexo.situacao !== "enviando") return { anexo: semCaminho(anexo) };
    const chegou = await servicos.deposito.info(anexo.caminho);
    if (!chegou || chegou.tamanho !== anexo.tamanho) {
      return resposta
        .code(409)
        .send({ code: "ENVIO_INCOMPLETO", message: "O arquivo não chegou inteiro. Tente anexar de novo." });
    }
    await naEmpresa(pedido, (c) => marcarVerificando(c, anexo.id));
    await registrar(pedido, "anexo.enviou", id, {
      anexoId: anexo.id,
      tipo: anexo.tipo,
      tamanho: anexo.tamanho,
    });
    o.acordarFila();
    return { anexo: { ...semCaminho(anexo), situacao: "verificando" } };
  });

  // Link para baixar ou ver (5 minutos), só de anexo liberado pelo antivírus.
  app.get("/tarefas/:id/anexos/:anexoId/link", ver, async (pedido, resposta) => {
    if (!o.servicos) return desligados(resposta);
    const servicos = o.servicos;
    const { id, anexoId } = pedido.params as { id: string; anexoId: string };
    const quem = quemPara(pedido, "ver");
    const anexo = await naEmpresa(pedido, async (c) => {
      if (!quem || !(await buscarTarefa(c, quem, id))) return null;
      return buscarAnexo(c, id, anexoId);
    });
    if (anexo?.situacao !== "disponivel") return naoEncontrado(resposta);
    const link = servicos.deposito.linkDeDownload(anexo.caminho, anexo.nome, anexo.tipo, SEGUNDOS);
    await registrar(pedido, "anexo.baixou", id, { anexoId: anexo.id });
    return { url: link.url, expiraEm: link.expiraEm.toISOString() };
  });

  app.delete("/tarefas/:id/anexos/:anexoId", ver, async (pedido, resposta) => {
    const { id, anexoId } = pedido.params as { id: string; anexoId: string };
    const { sessao, permissoes } = acessoDo(pedido);
    const excluiTodas = permissoes.modulos.get("tarefas")?.acoes.excluir === "tudo";
    const quem = quemPara(pedido, "ver");
    const feito = await naEmpresa(pedido, async (c) => {
      if (!quem || !(await buscarTarefa(c, quem, id))) return null;
      const anexo = await buscarAnexo(c, id, anexoId, true);
      if (!anexo) return null;
      const meu = anexo.enviadoPor.tipo === "pessoa" && anexo.enviadoPor.pessoaId === sessao.pessoa.id;
      if (!meu && !excluiTodas) return { recusa: true as const };
      await excluirAnexo(c, anexo.id);
      return { anexo };
    });
    if (!feito) return naoEncontrado(resposta);
    if ("recusa" in feito)
      return resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só quem enviou exclui este anexo." });
    await registrar(pedido, "anexo.excluiu", id, { anexoId: feito.anexo.id });
    o.acordarFila();
    return resposta.code(204).send();
  });

  // Quanto os anexos da empresa ocupam (tela de administração).
  app.get(
    "/empresa/espaco-dos-anexos",
    { preHandler: verificador.exigir("seguranca", "ver") },
    async (pedido) => ({ bytes: await naEmpresa(pedido, espacoDaEmpresa) }),
  );
}

/**
 * Só no Mac e nos testes: a API faz o papel do depósito, servindo os links assinados (/deposito-local/<token>).
 * Fica num escopo próprio, porque aceita o corpo do pedido como arquivo (até 25 MB).
 */
export async function registrarDepositoLocal(app: FastifyInstance, deposito: DepositoEmDisco): Promise<void> {
  await app.register(async (escopo) => {
    escopo.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 26 * 1024 * 1024 }, (_p, corpo, feito) =>
      feito(null, corpo),
    );
    escopo.put("/deposito-local/:token", async (pedido, resposta) => {
      const { token } = pedido.params as { token: string };
      const link = deposito.conferirLink(token);
      const corpo = pedido.body as Buffer | undefined;
      if (
        link?.metodo !== "PUT" ||
        !corpo ||
        corpo.length !== link.tamanho ||
        pedido.headers["content-type"] !== link.tipo
      )
        return resposta
          .code(403)
          .send({ code: "LINK_INVALIDO", message: "Link vencido ou diferente do autorizado." });
      await deposito.gravar(link.caminho, corpo);
      return resposta.code(200).send();
    });
    escopo.get("/deposito-local/:token", async (pedido, resposta) => {
      const { token } = pedido.params as { token: string };
      const link = deposito.conferirLink(token);
      if (link?.metodo !== "GET") return resposta.code(403).send({ code: "LINK_INVALIDO" });
      const info = await deposito.info(link.caminho);
      if (!info) return resposta.code(404).send({ code: "ANEXO_NAO_ENCONTRADO" });
      return resposta
        .header("content-type", podeVerNaTela(link.tipo) ? link.tipo : "application/octet-stream")
        .header("content-disposition", disposicao(link.nome, link.tipo))
        .header("x-content-type-options", "nosniff")
        .send(await deposito.ler(link.caminho));
    });
  });
}
