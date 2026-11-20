/**
 * Rotas das contas de IA (M4-01, decisão 0021). Só quem tem o módulo "Contas de IA" (padrão: o administrador).
 *
 * - A chave só entra (conectar e trocar) e nunca sai: nenhuma resposta, registro ou evento de auditoria a leva.
 * - Conectar e trocar a chave testam no provedor antes de gravar, e pedem o segundo fator recente.
 * - Os modelos chegam desligados; só modelo liberado pode ir para um agente.
 */
import {
  type ACOES_CONTAS_DE_IA,
  type ContaDeIa,
  conferir,
  conferirModelosDoAgente,
  PedidoDeContaDeIa,
  PedidoDeEditarContaDeIa,
  PedidoDeLiberarModelos,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { alcanceCobreAgente, buscarAgente } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import type { Cofre } from "./cofre.ts";
import { enderecoPermitido, type Provedores } from "./provedores.ts";
import {
  acertarModelos,
  agentesQueUsam,
  apagarConta,
  buscarConta,
  chaveCifradaDaConta,
  escolherModelos,
  gravarConta,
  liberarModelos,
  listarContas,
  listarModelos,
  marcarTeste,
  modeloIndisponivel,
  modelosDoAgente,
  mudarConta,
  novoId,
} from "./servico.ts";

type AcaoDeIa = (typeof ACOES_CONTAS_DE_IA)[number];

export interface OpcoesDasContasDeIa {
  verificador: Verificador;
  poolApp: pg.Pool;
  /** Nulo quando a chave mestra não foi configurada: as contas de IA ficam desligadas. */
  cofre: Cofre | null;
  provedores: Provedores;
  ambiente: "local" | "teste" | "producao";
}

const naoEncontrada = (r: FastifyReply) =>
  r.code(404).send({ code: "CONTA_NAO_ENCONTRADA", message: "Conta de IA não encontrada." });

const finalDa = (chave: string) => chave.slice(-4);

export function registrarRotasDasContasDeIa(app: FastifyInstance, o: OpcoesDasContasDeIa): void {
  const { verificador, poolApp, provedores } = o;

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  function registrar(
    pedido: FastifyRequest,
    acao: AcaoDeIa,
    alvo: { tipo: "conta_de_ia" | "agente"; id: string },
    detalhes: Record<string, unknown> = {},
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

  /** O cofre, ou a resposta de que as contas de IA estão desligadas neste servidor. */
  function cofreOu(resposta: FastifyReply): Cofre | null {
    if (!o.cofre) {
      void resposta.code(503).send({
        code: "COFRE_DESLIGADO",
        message: "As contas de IA ainda não foram ligadas neste servidor.",
      });
      return null;
    }
    return o.cofre;
  }

  function segundoFatorRecente(pedido: FastifyRequest): boolean {
    const { sessao } = acessoDo(pedido);
    return podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo);
  }

  const pedeConfirmacao = (r: FastifyReply) =>
    r.code(403).send({
      code: "CONFIRMACAO_NECESSARIA",
      message: "Por segurança, confirme com o código do app ou com a passkey antes de mexer na chave.",
    });

  app.get("/ia/contas", { preHandler: verificador.exigir("contas_de_ia", "ver") }, async (pedido) => ({
    ligado: o.cofre !== null,
    contas: await naEmpresa(pedido, (c) => listarContas(c)),
  }));

  app.get(
    "/ia/contas/:id/modelos",
    { preHandler: verificador.exigir("contas_de_ia", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) =>
        (await buscarConta(c, id)) ? listarModelos(c, id) : null,
      );
      return feito ?? naoEncontrada(resposta);
    },
  );

  app.post(
    "/ia/contas",
    { preHandler: verificador.exigir("contas_de_ia", "criar") },
    async (pedido, resposta) => {
      const cofre = cofreOu(resposta);
      if (!cofre) return resposta;
      const r = conferir(PedidoDeContaDeIa, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const p = r.valor;
      const endereco = p.provedor === "compativel_openai" ? (p.endereco ?? null) : null;
      if (p.provedor === "anthropic" && p.endereco)
        return resposta
          .code(400)
          .send({ code: "ENDERECO_INVALIDO", message: "A Anthropic usa o endereço oficial." });
      if (p.provedor === "compativel_openai" && (!endereco || !enderecoPermitido(endereco, o.ambiente)))
        return resposta.code(400).send({
          code: "ENDERECO_INVALIDO",
          message: "Informe o endereço público da API do provedor, com https.",
        });
      if (!segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      // Testa antes de gravar: chave recusada não fica guardada.
      const teste = await provedores.testar({ provedor: p.provedor, endereco, chave: p.chave });
      if (!teste.ok) return resposta.code(422).send({ code: "CHAVE_RECUSADA", message: teste.erro });
      const { sessao } = acessoDo(pedido);
      try {
        const conta = await naEmpresa(pedido, async (c) => {
          const id = await novoId(c);
          const conta = await gravarConta(c, {
            id,
            nome: p.nome,
            provedor: p.provedor,
            endereco,
            chaveCifrada: await cofre.guardarChaveDeIa(c, sessao.empresaId, id, p.chave),
            finalDaChave: finalDa(p.chave),
            tetoMensal: p.tetoMensal ?? null,
            criadaPor: sessao.pessoa.id,
          });
          await acertarModelos(c, id, teste.modelos);
          return conta;
        });
        await registrar(
          pedido,
          "ia.conectou",
          { tipo: "conta_de_ia", id: conta.id },
          {
            nome: conta.nome,
            provedor: conta.provedor,
            finalDaChave: conta.finalDaChave,
            modelos: teste.modelos.length,
          },
        );
        return resposta.code(201).send(conta);
      } catch (erro) {
        if ((erro as { constraint?: string }).constraint === "contas_de_ia_nome_unico")
          return resposta
            .code(409)
            .send({ code: "NOME_EM_USO", message: "Já existe uma conta de IA com esse nome." });
        throw erro;
      }
    },
  );

  app.post(
    "/ia/contas/:id",
    { preHandler: verificador.exigir("contas_de_ia", "editar") },
    async (pedido, resposta) => {
      const cofre = cofreOu(resposta);
      if (!cofre) return resposta;
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarContaDeIa, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const p = r.valor;
      if (p.chave !== undefined && !segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      const { sessao } = acessoDo(pedido);
      const atual = await naEmpresa(pedido, (c) => buscarConta(c, id));
      if (!atual) return naoEncontrada(resposta);
      let modelos: string[] | null = null;
      if (p.chave !== undefined) {
        const teste = await provedores.testar({
          provedor: atual.provedor,
          endereco: atual.endereco,
          chave: p.chave,
        });
        if (!teste.ok) return resposta.code(422).send({ code: "CHAVE_RECUSADA", message: teste.erro });
        modelos = teste.modelos;
      }
      try {
        const conta = await naEmpresa(pedido, async (c) => {
          if (!(await buscarConta(c, id, true))) return null;
          const chave = p.chave;
          const feita = await mudarConta(c, id, {
            ...(p.nome !== undefined ? { nome: p.nome } : {}),
            ...(p.tetoMensal !== undefined ? { tetoMensal: p.tetoMensal } : {}),
            ...(chave !== undefined
              ? {
                  chaveCifrada: await cofre.guardarChaveDeIa(c, sessao.empresaId, id, chave),
                  finalDaChave: finalDa(chave),
                }
              : {}),
          });
          if (modelos) await acertarModelos(c, id, modelos);
          return feita;
        });
        if (!conta) return naoEncontrada(resposta);
        if (p.chave !== undefined)
          await registrar(
            pedido,
            "ia.trocou_chave",
            { tipo: "conta_de_ia", id },
            {
              nome: conta.nome,
              finalAnterior: atual.finalDaChave,
              finalDaChave: conta.finalDaChave,
            },
          );
        const mudou = (["nome", "tetoMensal"] as const).filter(
          (k) => p[k] !== undefined && p[k] !== atual[k],
        );
        if (mudou.length > 0)
          await registrar(
            pedido,
            "ia.editou",
            { tipo: "conta_de_ia", id },
            {
              mudou,
              ...(mudou.includes("tetoMensal") ? { tetoMensal: conta.tetoMensal } : {}),
            },
          );
        return conta;
      } catch (erro) {
        if ((erro as { constraint?: string }).constraint === "contas_de_ia_nome_unico")
          return resposta
            .code(409)
            .send({ code: "NOME_EM_USO", message: "Já existe uma conta de IA com esse nome." });
        throw erro;
      }
    },
  );

  app.post(
    "/ia/contas/:id/testar",
    { preHandler: verificador.exigir("contas_de_ia", "editar") },
    async (pedido, resposta) => {
      const cofre = cofreOu(resposta);
      if (!cofre) return resposta;
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      // A chave é aberta numa transação curta e o pedido ao provedor acontece fora dela.
      const aberta = await naEmpresa(pedido, async (c) => {
        const conta = await buscarConta(c, id);
        const cifrada = conta ? await chaveCifradaDaConta(c, id) : null;
        if (!conta || !cifrada) return null;
        return { conta, chave: await cofre.abrirChaveDeIa(c, sessao.empresaId, id, cifrada) };
      });
      if (!aberta) return naoEncontrada(resposta);
      const teste = await provedores.testar({
        provedor: aberta.conta.provedor,
        endereco: aberta.conta.endereco,
        chave: aberta.chave,
      });
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await buscarConta(c, id, true))) return null;
        const conta = await marcarTeste(c, id, teste.ok ? null : teste.erro);
        const novos = teste.ok ? await acertarModelos(c, id, teste.modelos) : 0;
        return { conta, novos };
      });
      if (!feito) return naoEncontrada(resposta);
      await registrar(
        pedido,
        "ia.testou",
        { tipo: "conta_de_ia", id },
        {
          ok: teste.ok,
          ...(teste.ok ? { modelos: teste.modelos.length, novos: feito.novos } : {}),
        },
      );
      return { ...feito.conta, modelosNovos: feito.novos };
    },
  );

  app.post(
    "/ia/contas/:id/modelos",
    { preHandler: verificador.exigir("contas_de_ia", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeLiberarModelos, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await buscarConta(c, id, true))) return "nao_encontrada" as const;
        const desligar = r.valor.modelos.filter((m) => !m.liberado).map((m) => m.modelo);
        const usam = desligar.length > 0 ? await agentesQueUsam(c, id, desligar) : [];
        if (usam.length > 0) return { usam };
        return { mudou: await liberarModelos(c, id, r.valor.modelos), modelos: await listarModelos(c, id) };
      });
      if (feito === "nao_encontrada") return naoEncontrada(resposta);
      if ("usam" in feito)
        return resposta.code(409).send({
          code: "MODELO_EM_USO",
          message: `Troque antes o modelo destes agentes: ${feito.usam.join(", ")}.`,
        });
      if (feito.mudou.liberados.length + feito.mudou.desligados.length > 0)
        await registrar(pedido, "ia.liberou_modelo", { tipo: "conta_de_ia", id }, feito.mudou);
      return feito.modelos;
    },
  );

  app.delete(
    "/ia/contas/:id",
    { preHandler: verificador.exigir("contas_de_ia", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const apagada = await naEmpresa(pedido, async (c): Promise<ContaDeIa | null> => {
        const conta = await buscarConta(c, id, true);
        if (conta) await apagarConta(c, id);
        return conta;
      });
      if (!apagada) return naoEncontrada(resposta);
      await registrar(
        pedido,
        "ia.apagou",
        { tipo: "conta_de_ia", id },
        {
          nome: apagada.nome,
          provedor: apagada.provedor,
          finalDaChave: apagada.finalDaChave,
        },
      );
      return resposta.code(204).send();
    },
  );

  // Modelo principal e reserva de um agente (o motor dos agentes internos usa na M4-02).
  app.get(
    "/agentes/:id/modelos",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) =>
        (await buscarAgente(c, id)) ? { modelos: await modelosDoAgente(c, id) } : null,
      );
      return (
        feito ?? resposta.code(404).send({ code: "AGENTE_NAO_ENCONTRADO", message: "Agente não encontrado." })
      );
    },
  );

  app.post(
    "/agentes/:id/modelos",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const corpo = (pedido.body ?? {}) as { modelos?: unknown };
      const r = corpo.modelos === null ? null : conferirModelosDoAgente(corpo.modelos);
      if (r && !r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const modelos = r?.ok ? r.valor : null;
      const feito = await naEmpresa(pedido, async (c) => {
        const agente = await buscarAgente(c, id, true);
        if (!agente || !(await alcanceCobreAgente(c, acessoDo(pedido).filtro, agente)))
          return "nao_encontrado";
        if (agente.situacao === "desligado") return "desligado";
        for (const m of modelos ? [modelos.principal, ...(modelos.reserva ? [modelos.reserva] : [])] : []) {
          const motivo = await modeloIndisponivel(c, m);
          if (motivo) return `O modelo ${m.modelo} não pode ser usado: ${motivo}.`;
        }
        await escolherModelos(c, id, modelos);
        return "ok";
      });
      if (feito === "nao_encontrado")
        return resposta.code(404).send({ code: "AGENTE_NAO_ENCONTRADO", message: "Agente não encontrado." });
      if (feito === "desligado")
        return resposta
          .code(409)
          .send({ code: "AGENTE_DESLIGADO", message: "Agente desligado não muda mais." });
      if (feito !== "ok") return resposta.code(400).send({ code: "MODELO_INDISPONIVEL", message: feito });
      await registrar(
        pedido,
        "agente.escolheu_modelo",
        { tipo: "agente", id },
        {
          principal: modelos?.principal.modelo ?? null,
          reserva: modelos?.reserva?.modelo ?? null,
        },
      );
      return { modelos };
    },
  );
}
