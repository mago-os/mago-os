/**
 * Rotas da Central de agentes (M2-03), para a tela. Todo mundo da empresa vê os agentes (para escolher um como
 * responsável de tarefa); só o administrador cadastra, edita, pausa, retoma e desliga (padrão das permissões).
 * Desligar para o agente na hora: as tarefas que ele tinha pegado voltam para A fazer, as abertas passam para a
 * pessoa responsável, e ela recebe um aviso por e-mail. As chaves (M2-04) deixam de valer porque o agente
 * desligado é recusado.
 */
import {
  type ACOES_AGENTES,
  type ACOES_CHAVES,
  type Agente,
  conferir,
  MINUTOS_SEM_SINAL_PADRAO,
  PedidoDeAgente,
  PedidoDeChave,
  PedidoDeEditarAgente,
  type SituacaoAgente,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import type { Carteiro } from "../acesso/login.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarResponsavel } from "../avisos/index.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { pessoaAtivaNaEmpresa } from "../tarefas/servico.ts";
import { autenticarAgente, criarChave, listarChaves, revogarChave } from "./chaves.ts";
import { entrarNaParada, haParadaAtiva, paradaDoAgente, retomarDaParada } from "./parada.ts";
import { auditarRetomada, pedeConfirmacao, respostaDaRetomada } from "./rotas-da-parada.ts";
import {
  alcanceCobreAgente,
  buscarAgente,
  cadastrarAgente,
  devolverTarefasPegadas,
  editarAgente,
  garantirAgentesDeNascenca,
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
  /** Limites dos agentes (os testes usam valores pequenos). */
  limites?: { pedidosPorMinuto: number; leiturasPorHora: number };
  /** Põe na fila as execuções que a retomada de uma parada devolveu (M4-09). */
  acordar?: (empresaId: string, execucaoId: string) => void;
}

const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "AGENTE_NAO_ENCONTRADO", message: "Agente não encontrado." });

/** Erro de nome repetido entre agentes vivos da mesma empresa (índice agentes_nome_unico). */
function nomeRepetido(erro: unknown): boolean {
  return (erro as { constraint?: string }).constraint === "agentes_nome_unico";
}

export function registrarRotasDosAgentes(app: FastifyInstance, o: OpcoesDosAgentes): void {
  const { verificador, poolApp } = o;

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  /** O agente, se existe e o alcance da ação de quem pede o cobre (ex.: "meus" = só os de que é responsável). */
  async function agenteAlcancado(c: pg.PoolClient, pedido: FastifyRequest, id: string) {
    const atual = await buscarAgente(c, id, true);
    if (!atual) return null;
    return (await alcanceCobreAgente(c, acessoDo(pedido).filtro, atual)) ? atual : null;
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
    naEmpresa(pedido, async (c) => {
      // Empresa nova ganha o Coordenador e o Gerente de projetos no primeiro uso (M4-02).
      await garantirAgentesDeNascenca(c);
      return listarAgentes(c);
    }),
  );

  app.get("/agentes/:id", { preHandler: verificador.exigir("agentes", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const [agente] = await naEmpresa(pedido, (c) => listarAgentes(c, id));
    return agente ?? naoEncontrado(resposta);
  });

  app.post("/agentes", { preHandler: verificador.exigir("agentes", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeAgente, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    try {
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await pessoaAtivaNaEmpresa(c, r.valor.responsavelId))) return null;
        const novo = await cadastrarAgente(c, {
          nome: r.valor.nome,
          descricao: r.valor.descricao ?? null,
          ondeRoda: r.valor.ondeRoda ?? null,
          responsavelId: r.valor.responsavelId,
          minutosSemSinal: r.valor.minutosSemSinal ?? MINUTOS_SEM_SINAL_PADRAO,
        });
        // Com os agentes parados (M4-09), o agente novo nasce pausado e volta junto com os outros.
        return (await entrarNaParada(c, novo.id)) ? ((await buscarAgente(c, novo.id)) ?? novo) : novo;
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
          const atual = await agenteAlcancado(c, pedido, id);
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
            ...(r.valor.canais ? { canais: r.valor.canais } : {}),
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

  async function retomarAgenteDaParada(pedido: FastifyRequest, resposta: FastifyReply, id: string) {
    const { sessao, permissoes } = acessoDo(pedido);
    if (permissoes.modulos.get("agentes")?.acoes.excluir !== "tudo")
      return resposta.code(403).send({
        code: "SEM_PERMISSAO",
        message: "Os agentes foram parados todos juntos. Só quem pode parar e retomar todos retoma este.",
      });
    if (!podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo))
      return pedeConfirmacao(resposta);
    const feito = await naEmpresa(pedido, (c) =>
      retomarDaParada(c, {
        pessoaId: sessao.pessoa.id,
        nome: sessao.pessoa.nome,
        agenteIds: [id],
        comoDono: false,
      }),
    );
    const erro = respostaDaRetomada(resposta, feito);
    if (erro || "erro" in feito) return erro;
    await auditarRetomada(poolApp, pedido, {
      empresaId: sessao.empresaId,
      pessoaId: sessao.pessoa.id,
      paradaId: feito.parada.id,
      detalhes: { agentes: feito.retomados, naoVoltaram: feito.naoVoltaram, terminou: feito.terminou },
    });
    for (const e of feito.acordar) o.acordar?.(sessao.empresaId, e);
    return naEmpresa(pedido, (c) => buscarAgente(c, id));
  }

  /** Pausar e retomar: só muda a situação (as chaves continuam guardadas). */
  function rotaDeSituacao(caminho: string, para: SituacaoAgente, de: SituacaoAgente, acao: AcaoDeAgente) {
    app.post(caminho, { preHandler: verificador.exigir("agentes", "editar") }, async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      // Durante uma parada (M4-09), o agente dela volta pela retomada da parada (com o segundo fator), e a tarefa que
      // ela interrompeu volta à fila dele.
      // Um agente pausado antes da parada (ou que ficou de fora dela) não liga enquanto ela durar.
      if (para === "ativo") {
        const naParada = await naEmpresa(pedido, async (c) =>
          (await agenteAlcancado(c, pedido, id))
            ? (await paradaDoAgente(c, id))
              ? ("dele" as const)
              : (await haParadaAtiva(c))
                ? ("da_empresa" as const)
                : null
            : null,
        );
        if (naParada === "dele") return retomarAgenteDaParada(pedido, resposta, id);
        if (naParada === "da_empresa")
          return resposta.code(409).send({
            code: "AGENTES_PARADOS",
            message:
              "Os agentes estão parados. Retome a parada pelo aviso no topo antes de ligar este agente.",
          });
      }
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = await agenteAlcancado(c, pedido, id);
        if (!atual) return null;
        if (atual.situacao !== de) return atual.situacao;
        // O agente interno só liga com um modelo de IA escolhido (M4-02).
        if (para === "ativo" && atual.tipo === "interno") {
          const m = await c.query(
            "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and modelo_principal is not null",
            [id],
          );
          if ((m.rowCount ?? 0) === 0) return "sem_modelo" as const;
        }
        return mudarSituacao(c, id, para);
      });
      if (!feito) return naoEncontrado(resposta);
      if (feito === "sem_modelo")
        return resposta.code(409).send({
          code: "SEM_MODELO",
          message: "Escolha o modelo de IA do agente antes de ligar.",
        });
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
        const atual = await agenteAlcancado(c, pedido, id);
        if (!atual) return null;
        if (atual.situacao === "desligado") return "desligado" as const;
        const agente: Agente = await mudarSituacao(c, id, "desligado");
        const devolvidas = await devolverTarefasPegadas(
          c,
          id,
          `O agente ${agente.nome} foi desligado e a tarefa voltou para A fazer.`,
        );
        const passadas = await passarTarefasAoResponsavel(c, agente, new Set(devolvidas.map((t) => t.id)));
        // Uma tarefa pode estar nas duas listas (pegada e atribuída ao agente): conta uma vez só.
        const tarefas = [...new Map([...devolvidas, ...passadas].map((t) => [t.id, t])).values()];
        // Aviso no Mago OS (na transação) e por e-mail (depois). O e-mail não segura o desligamento.
        const avisar = await avisarResponsavel(
          c,
          {
            agenteId: id,
            agenteNome: agente.nome,
            responsavelId: agente.responsavelId,
            tipo: "agente_desligado",
            oQueAconteceu: "foi desligado",
            tarefas: tarefas.map((t) => t.titulo),
          },
          o.carteiro,
          o.urlPublica,
          pedido.log,
        );
        return { agente, tarefas, avisar };
      });
      if (!feito) return naoEncontrado(resposta);
      if (feito === "desligado") return desligadoNaoMuda(resposta);
      await registrar(pedido, "agente.desligou", id, { tarefasDevolvidas: feito.tarefas.length });
      await feito.avisar();
      return feito.agente;
    },
  );

  // Chaves do agente (M2-04): listar, criar (a chave inteira só na resposta) e revogar. Só quem edita o agente.
  app.get(
    "/agentes/:id/chaves",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const lista = await naEmpresa(pedido, async (c) =>
        (await agenteAlcancado(c, pedido, id)) ? listarChaves(c, id) : null,
      );
      return lista ?? naoEncontrado(resposta);
    },
  );

  app.post(
    "/agentes/:id/chaves",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeChave, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      if (r.valor.validaAte && Date.parse(r.valor.validaAte) <= Date.now()) {
        return resposta
          .code(400)
          .send({ code: "VALIDADE_INVALIDA", message: "A validade precisa ser no futuro." });
      }
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const agente = await agenteAlcancado(c, pedido, id);
        if (!agente) return null;
        if (agente.situacao === "desligado") return "desligado" as const;
        return criarChave(c, {
          agenteId: id,
          nome: r.valor.nome,
          validaAte: r.valor.validaAte ?? null,
          criadaPor: sessao.pessoa.id,
        });
      });
      if (!feito) return naoEncontrado(resposta);
      if (feito === "desligado") return desligadoNaoMuda(resposta);
      await registrarChave(pedido, "chave.criou", feito.chave.id, {
        agenteId: id,
        prefixo: feito.chave.prefixo,
        comValidade: feito.chave.validaAte !== null,
      });
      // A chave inteira só aqui, e sem guardar em cache nenhum.
      resposta.header("cache-control", "no-store");
      return resposta.code(201).send(feito);
    },
  );

  app.post(
    "/agentes/:id/chaves/:chaveId/revogar",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id, chaveId } = pedido.params as { id: string; chaveId: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) =>
        (await agenteAlcancado(c, pedido, id)) ? revogarChave(c, id, chaveId, sessao.pessoa.id) : null,
      );
      if (!feito) {
        return resposta
          .code(404)
          .send({ code: "CHAVE_NAO_ENCONTRADA", message: "Chave não encontrada ou já revogada." });
      }
      await registrarChave(pedido, "chave.revogou", feito.id, { agenteId: id, prefixo: feito.prefixo });
      return feito;
    },
  );

  function registrarChave(
    pedido: FastifyRequest,
    acao: (typeof ACOES_CHAVES)[number],
    chaveId: string,
    detalhes: Record<string, unknown>,
  ) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "chave", id: chaveId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }
}

/**
 * Pedido de um agente, com a chave no cabeçalho Authorization (M2-04). A M2-05 usa o mesmo caminho para o MCP.
 * "estou vivo" só registra o sinal de vida (a conferência da chave já faz isso).
 */
export function registrarRotasDoAgente(app: FastifyInstance, o: OpcoesDosAgentes): void {
  app.post("/agente/estou-vivo", async (pedido, resposta) => {
    const r = await autenticarAgente(pedido.headers.authorization, {
      poolApp: o.poolApp,
      carteiro: o.carteiro,
      urlPublica: o.urlPublica,
      log: pedido.log,
      origem: { ...origemDoPedido(pedido), canal: "api" },
      rastreio: pedido.id,
      ...(o.limites ? { limites: o.limites } : {}),
    });
    if (!r.ok) return resposta.code(r.status).send({ code: "CHAVE_RECUSADA", motivo: r.motivo });
    return { ok: true, agenteId: r.agente.agenteId };
  });
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
