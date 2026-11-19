/**
 * Rotas dos espaços e projetos (M3-01), para a tela. Cada rota passa pela verificação central (módulos "espacos" e
 * "projetos"), e o alcance decide quais projetos a pessoa alcança: o administrador e o gestor, todos; o funcionário,
 * os que é membro. Editar um projeto com alcance "meus" é ser o diretor dele. Cada mudança vira evento de auditoria.
 */
import {
  type ACOES_PROJETOS,
  conferir,
  type Espaco,
  PedidoDeEditarEspaco,
  PedidoDeEditarProjeto,
  PedidoDeEspaco,
  PedidoDeProjeto,
  type Projeto,
  type Responsavel,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { nomesCitados, pessoaAtivaNaEmpresa } from "../tarefas/servico.ts";
import {
  type AlcanceDeProjeto,
  buscarEspaco,
  buscarProjeto,
  COR_PADRAO,
  criarEspaco,
  criarProjeto,
  type DadosDoProjeto,
  editarEspaco,
  editarProjeto,
  excluirProjeto,
  listarEspacos,
  listarProjetos,
  membrosComuns,
  tarefasAbertasPorProjeto,
} from "./servico.ts";

type AcaoDeProjeto = (typeof ACOES_PROJETOS)[number];

const invalido = (resposta: FastifyReply, problemas: unknown) =>
  resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas });
const espacoNaoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "ESPACO_NAO_ENCONTRADO", message: "Espaço não encontrado." });
const projetoNaoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "PROJETO_NAO_ENCONTRADO", message: "Projeto não encontrado." });
const recusado = (resposta: FastifyReply, message: string) =>
  resposta.code(400).send({ code: "PROJETO_INVALIDO", message });

const sim = (v: unknown) => [v].flat().some((x) => x === "1" || x === "true");

/** O alcance da ação vira o alcance nos projetos. "Meus": ver = sou membro; editar = sou o diretor. */
export function alcanceDeProjetoDo(pedido: FastifyRequest): AlcanceDeProjeto {
  const { filtro, acao } = acessoDo(pedido);
  if (filtro.tipo === "tudo") return "todos";
  return acao === "editar" ? "diretor" : "membro";
}

/** Os ids de pessoas e agentes citados nos projetos (para mostrar os nomes). */
export function idsDosProjetos(projetos: Projeto[]): string[] {
  return projetos.flatMap((p) =>
    p.membros.map((m) => (m.quem.tipo === "pessoa" ? m.quem.pessoaId : m.quem.agenteId)),
  );
}

/** Confere se diretor, gerente e membros podem estar no projeto. Devolve o motivo da recusa. */
async function pessoasRecusadas(
  c: pg.PoolClient,
  d: DadosDoProjeto,
  mudou: Set<string>,
): Promise<string | null> {
  if (mudou.has("diretorId") && !(await pessoaAtivaNaEmpresa(c, d.diretorId))) {
    return "O diretor precisa ser uma pessoa ativa nesta empresa.";
  }
  const ativo = async (r: Responsavel) =>
    r.tipo === "pessoa" ? pessoaAtivaNaEmpresa(c, r.pessoaId) : agenteRecebeTarefas(c, r.agenteId);
  if (mudou.has("gerente") && d.gerente && !(await ativo(d.gerente))) {
    return "O gerente precisa ser uma pessoa ou um agente ativo nesta empresa.";
  }
  if (mudou.has("membros")) {
    for (const m of membrosComuns(d)) {
      if (!(await ativo(m))) return "Todos os membros precisam ser pessoas ou agentes ativos nesta empresa.";
    }
  }
  if (d.gerenteRecebeSemResponsavel && !d.gerente) {
    return "Para receber as tarefas sem responsável, o projeto precisa de um gerente.";
  }
  if (d.inicio && d.fim && d.fim < d.inicio) return "O fim vem depois do início.";
  return null;
}

const chave = (r: Responsavel | null) =>
  r === null ? null : r.tipo === "pessoa" ? `p:${r.pessoaId}` : `a:${r.agenteId}`;

export function registrarRotasDosProjetos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  function registrar(
    pedido: FastifyRequest,
    acao: AcaoDeProjeto,
    alvo: { tipo: "espaco" | "projeto"; id: string },
    detalhes = {},
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

  const eu = (pedido: FastifyRequest) => acessoDo(pedido).sessao.pessoa.id;

  // Espaços --------------------------------------------------------------------------------------------------

  app.get("/espacos", { preHandler: verificador.exigir("espacos", "ver") }, async (pedido) => {
    const q = pedido.query as { arquivados?: string };
    return naEmpresa(pedido, async (c) => ({ espacos: await listarEspacos(c, sim(q.arquivados)) }));
  });

  app.post("/espacos", { preHandler: verificador.exigir("espacos", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeEspaco, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const espaco = await naEmpresa(pedido, (c) =>
      criarEspaco(c, {
        nome: r.valor.nome,
        descricao: r.valor.descricao ?? null,
        cor: r.valor.cor ?? COR_PADRAO,
      }),
    );
    await registrar(pedido, "espaco.criou", { tipo: "espaco", id: espaco.id });
    return resposta.code(201).send(espaco);
  });

  app.post(
    "/espacos/:id",
    { preHandler: verificador.exigir("espacos", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarEspaco, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const feito = await naEmpresa(pedido, async (c) => {
        const antes = await buscarEspaco(c, id, true);
        if (!antes) return null;
        const novo: Espaco = {
          ...antes,
          ...(r.valor.nome !== undefined ? { nome: r.valor.nome } : {}),
          ...(r.valor.descricao !== undefined ? { descricao: r.valor.descricao } : {}),
          ...(r.valor.cor !== undefined ? { cor: r.valor.cor } : {}),
          ...(r.valor.situacao !== undefined ? { situacao: r.valor.situacao } : {}),
        };
        return { antes, espaco: await editarEspaco(c, novo) };
      });
      if (!feito) return espacoNaoEncontrado(resposta);
      const alvo = { tipo: "espaco" as const, id };
      if (feito.antes.situacao !== feito.espaco.situacao) {
        await registrar(pedido, "espaco.arquivou", alvo, { situacao: feito.espaco.situacao });
      }
      const campos = (["nome", "descricao", "cor"] as const).filter(
        (k) => feito.antes[k] !== feito.espaco[k],
      );
      if (campos.length > 0) await registrar(pedido, "espaco.editou", alvo, { campos });
      return feito.espaco;
    },
  );

  // Projetos -------------------------------------------------------------------------------------------------

  app.get("/projetos", { preHandler: verificador.exigir("projetos", "ver") }, async (pedido) => {
    const q = pedido.query as { espaco?: string; arquivados?: string };
    const alcance = alcanceDeProjetoDo(pedido);
    return naEmpresa(pedido, async (c) => {
      const projetos = await listarProjetos(c, eu(pedido), alcance, {
        ...(q.espaco ? { espacoId: q.espaco } : {}),
        arquivados: sim(q.arquivados),
      });
      return {
        projetos,
        abertas: await tarefasAbertasPorProjeto(
          c,
          projetos.map((p) => p.id),
        ),
        nomes: await nomesCitados(c, idsDosProjetos(projetos)),
      };
    });
  });

  app.get(
    "/projetos/:id",
    { preHandler: verificador.exigir("projetos", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const alcance = alcanceDeProjetoDo(pedido);
      const achou = await naEmpresa(pedido, async (c) => {
        const projeto = await buscarProjeto(c, eu(pedido), alcance, id);
        if (!projeto) return null;
        const espaco = await buscarEspaco(c, projeto.espacoId);
        return { projeto, espaco, nomes: await nomesCitados(c, idsDosProjetos([projeto])) };
      });
      return achou ?? projetoNaoEncontrado(resposta);
    },
  );

  app.post("/projetos", { preHandler: verificador.exigir("projetos", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeProjeto, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const v = r.valor;
    const { filtro } = acessoDo(pedido);
    // Sem diretor informado, quem cria é o diretor. Com alcance "meus", só cria projeto que ela mesma dirige.
    const diretorId = v.diretorId ?? eu(pedido);
    if (filtro.tipo !== "tudo" && diretorId !== eu(pedido)) {
      return resposta
        .code(403)
        .send({ code: "SEM_PERMISSAO", message: "Você só pode criar projetos em que é o diretor." });
    }
    const dados: DadosDoProjeto = {
      espacoId: v.espacoId,
      nome: v.nome,
      descricao: v.descricao ?? null,
      cor: v.cor ?? COR_PADRAO,
      diretorId,
      gerente: v.gerente ?? null,
      membros: v.membros ?? [],
      gerenteRecebeSemResponsavel: v.gerenteRecebeSemResponsavel ?? false,
      inicio: v.inicio ?? null,
      fim: v.fim ?? null,
      situacao: "ativo",
    };
    if (chave(dados.gerente) === `p:${diretorId}`)
      return recusado(resposta, "O diretor não pode ser também o gerente.");
    const feito = await naEmpresa(pedido, async (c) => {
      const espaco = await buscarEspaco(c, dados.espacoId);
      if (espaco?.situacao !== "ativo") return { recusa: "Escolha um espaço ativo desta empresa." };
      const recusa = await pessoasRecusadas(c, dados, new Set(["diretorId", "gerente", "membros"]));
      if (recusa) return { recusa };
      return { projeto: await criarProjeto(c, dados) };
    });
    if ("recusa" in feito) return recusado(resposta, feito.recusa);
    const p = feito.projeto;
    await registrar(
      pedido,
      "projeto.criou",
      { tipo: "projeto", id: p.id },
      {
        espacoId: p.espacoId,
        gerente: p.gerente?.tipo ?? null,
        membros: p.membros.length,
      },
    );
    return resposta.code(201).send(p);
  });

  app.post(
    "/projetos/:id",
    { preHandler: verificador.exigir("projetos", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarProjeto, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const v = r.valor;
      const { filtro } = acessoDo(pedido);
      const alcance = alcanceDeProjetoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const antes = await buscarProjeto(c, eu(pedido), alcance, id, true);
        if (!antes) return null;
        // Quem edita como diretor não passa a direção para outro: isso fica com quem vê todos os projetos.
        if (v.diretorId !== undefined && v.diretorId !== antes.diretorId && filtro.tipo !== "tudo") {
          return { recusa: "Só o administrador troca o diretor do projeto." };
        }
        const comuns = antes.membros.filter((m) => m.papel === "membro").map((m) => m.quem);
        const dados: DadosDoProjeto = {
          espacoId: v.espacoId ?? antes.espacoId,
          nome: v.nome ?? antes.nome,
          descricao: v.descricao !== undefined ? v.descricao : antes.descricao,
          cor: v.cor ?? antes.cor,
          diretorId: v.diretorId ?? antes.diretorId,
          gerente: v.gerente !== undefined ? v.gerente : antes.gerente,
          membros: v.membros ?? comuns,
          gerenteRecebeSemResponsavel:
            v.gerenteRecebeSemResponsavel ??
            (antes.gerenteRecebeSemResponsavel && (v.gerente ?? antes.gerente) !== null),
          inicio: v.inicio !== undefined ? v.inicio : antes.inicio,
          fim: v.fim !== undefined ? v.fim : antes.fim,
          situacao: v.situacao ?? antes.situacao,
        };
        if (chave(dados.gerente) === `p:${dados.diretorId}`)
          return { recusa: "O diretor não pode ser também o gerente." };
        if (dados.espacoId !== antes.espacoId) {
          const espaco = await buscarEspaco(c, dados.espacoId);
          if (espaco?.situacao !== "ativo") return { recusa: "Escolha um espaço ativo desta empresa." };
        }
        const mudou = new Set<string>();
        if (dados.diretorId !== antes.diretorId) mudou.add("diretorId");
        if (chave(dados.gerente) !== chave(antes.gerente)) mudou.add("gerente");
        if (v.membros !== undefined) mudou.add("membros");
        const recusa = await pessoasRecusadas(c, dados, mudou);
        if (recusa) return { recusa };
        return { antes, projeto: await editarProjeto(c, id, dados), mudou };
      });
      if (!feito) return projetoNaoEncontrado(resposta);
      if ("recusa" in feito) return recusado(resposta, feito.recusa);
      const { antes, projeto: p, mudou } = feito;
      const alvo = { tipo: "projeto" as const, id };
      if (mudou.has("diretorId")) await registrar(pedido, "projeto.trocou_diretor", alvo);
      if (mudou.has("gerente"))
        await registrar(pedido, "projeto.trocou_gerente", alvo, { gerente: p.gerente?.tipo ?? null });
      const membrosDe = (x: Projeto) =>
        x.membros
          .filter((m) => m.papel === "membro")
          .map((m) => chave(m.quem))
          .sort()
          .join(",");
      if (membrosDe(antes) !== membrosDe(p)) {
        await registrar(pedido, "projeto.mudou_membros", alvo, {
          membros: p.membros.filter((m) => m.papel === "membro").length,
        });
      }
      if (antes.situacao !== p.situacao)
        await registrar(pedido, "projeto.arquivou", alvo, { situacao: p.situacao });
      const campos = (
        ["espacoId", "nome", "descricao", "cor", "inicio", "fim", "gerenteRecebeSemResponsavel"] as const
      ).filter((k) => antes[k] !== p[k]);
      if (campos.length > 0) await registrar(pedido, "projeto.editou", alvo, { campos });
      return p;
    },
  );

  app.delete(
    "/projetos/:id",
    { preHandler: verificador.exigir("projetos", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const alcance = alcanceDeProjetoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const projeto = await buscarProjeto(c, eu(pedido), alcance, id, true);
        if (!projeto) return "nao" as const;
        return (await excluirProjeto(c, id)) ? ("ok" as const) : ("tem_tarefas" as const);
      });
      if (feito === "nao") return projetoNaoEncontrado(resposta);
      if (feito === "tem_tarefas") {
        return resposta.code(409).send({
          code: "PROJETO_COM_TAREFAS",
          message: "Esse projeto tem tarefas. Arquive o projeto ou mova as tarefas antes de excluir.",
        });
      }
      await registrar(pedido, "projeto.excluiu", { tipo: "projeto", id });
      return { ok: true };
    },
  );
}
