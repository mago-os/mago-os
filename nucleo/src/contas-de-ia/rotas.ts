/**
 * Rotas das contas de IA (M4-01, decisão 0021). Só quem tem o módulo "Contas de IA" (padrão: o administrador).
 *
 * - A chave só entra (conectar e trocar) e nunca sai: nenhuma resposta, registro ou evento de auditoria a leva.
 * - Conectar e trocar a chave testam no provedor antes de gravar, e pedem o segundo fator recente.
 * - Os modelos chegam desligados; só modelo liberado pode ir para um agente.
 * - Assinatura (M4-10, decisão 0022): o administrador aceita o aviso dos termos ao conectar (vai para a auditoria);
 *   o sistema não decide pela política do provedor. O login renovado volta ao cofre, e o limite do plano fica marcado.
 */
import {
  type ACOES_CONTAS_DE_IA,
  AVISO_DA_ASSINATURA,
  type ContaDeIa,
  conferir,
  conferirModelosDoAgente,
  conferirPedidoDeContaDeIa,
  PedidoDeEditarContaDeIa,
  PedidoDeLiberarModelos,
  problemasDaTrocaDeChave,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { alcanceCobreAgente, buscarAgente } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { type Cofre, ErroDoCofre } from "./cofre.ts";
import {
  enderecoPermitido,
  finalDaCredencial,
  type Provedores,
  type ResultadoDoTeste,
} from "./provedores.ts";
import {
  acertarModelos,
  agentesQueUsam,
  apagarConta,
  buscarConta,
  chaveCifradaDaConta,
  escolherModelos,
  gravarConta,
  guardarCredencialRenovada,
  liberarModelos,
  listarContas,
  listarModelos,
  marcarLimiteDoPlano,
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

const nomeRepetido = (r: FastifyReply) =>
  r.code(409).send({ code: "NOME_EM_USO", message: "Já existe uma conta de IA com esse nome." });

async function nomeEmUso(c: pg.PoolClient, nome: string): Promise<boolean> {
  const r = await c.query(
    "select 1 from contas_de_ia where empresa_id = empresa_ativa() and lower(nome) = lower($1)",
    [nome.trim()],
  );
  return (r.rowCount ?? 0) > 0;
}

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
      const r = conferirPedidoDeContaDeIa(pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const p = r.valor;
      const credencial = p.credencial ?? "chave_de_api";
      const endereco = p.provedor === "compativel_openai" ? (p.endereco ?? null) : null;
      if (p.provedor !== "compativel_openai" && p.endereco)
        return resposta
          .code(400)
          .send({ code: "ENDERECO_INVALIDO", message: "Este provedor usa o endereço oficial." });
      if (p.provedor === "compativel_openai" && (!endereco || !enderecoPermitido(endereco, o.ambiente)))
        return resposta.code(400).send({
          code: "ENDERECO_INVALIDO",
          message: "Informe o endereço público da API do provedor, com https.",
        });
      if (!segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      if (await naEmpresa(pedido, (c) => nomeEmUso(c, p.nome))) return nomeRepetido(resposta);
      // Testa antes de gravar: chave recusada não fica guardada.
      const teste = await provedores.testar({ provedor: p.provedor, credencial, endereco, chave: p.chave });
      if (!teste.ok) return resposta.code(422).send({ code: "CHAVE_RECUSADA", message: teste.erro });
      const { sessao } = acessoDo(pedido);
      // Na assinatura do ChatGPT, o teste renova o login: o que vai para o cofre é o renovado.
      const guardar = teste.credencialNova ?? p.chave;
      try {
        const conta = await naEmpresa(pedido, async (c) => {
          const id = await novoId(c);
          const conta = await gravarConta(c, {
            id,
            nome: p.nome,
            provedor: p.provedor,
            credencial,
            endereco,
            chaveCifrada: await cofre.guardarChaveDeIa(c, sessao.empresaId, id, guardar),
            finalDaChave: finalDaCredencial(p.provedor, guardar),
            tetoMensal: credencial === "assinatura" ? null : (p.tetoMensal ?? null),
            aceite:
              credencial === "assinatura"
                ? { pessoaId: sessao.pessoa.id, versao: AVISO_DA_ASSINATURA.versao }
                : null,
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
            credencial: conta.credencial,
            finalDaChave: conta.finalDaChave,
            modelos: teste.modelos.length,
          },
        );
        if (conta.credencial === "assinatura")
          await registrar(
            pedido,
            "ia.aceitou_termos",
            { tipo: "conta_de_ia", id: conta.id },
            { provedor: conta.provedor, versaoDoAviso: AVISO_DA_ASSINATURA.versao },
          );
        return resposta.code(201).send(conta);
      } catch (erro) {
        if ((erro as { constraint?: string }).constraint === "contas_de_ia_nome_unico")
          return nomeRepetido(resposta);
        throw erro;
      }
    },
  );

  app.post(
    "/ia/contas/:id",
    { preHandler: verificador.exigir("contas_de_ia", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarContaDeIa, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const p = r.valor;
      // O cofre só é preciso para trocar a chave: nome e teto mudam mesmo com ele desligado.
      const cofre = p.chave !== undefined ? cofreOu(resposta) : o.cofre;
      if (p.chave !== undefined && !cofre) return resposta;
      if (p.chave !== undefined && !segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      const { sessao } = acessoDo(pedido);
      const previa = await naEmpresa(pedido, (c) => buscarConta(c, id));
      if (!previa) return naoEncontrada(resposta);
      if (previa.credencial === "assinatura" && p.tetoMensal !== undefined && p.tetoMensal !== null)
        return resposta
          .code(400)
          .send({ code: "TETO_NA_ASSINATURA", message: "A assinatura não tem teto em dólar." });
      let modelos: string[] | null = null;
      let guardar: string | null = null;
      if (p.chave !== undefined) {
        const problemas = problemasDaTrocaDeChave(previa, p.chave);
        if (problemas.length > 0) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas });
        const teste = await provedores.testar({
          provedor: previa.provedor,
          credencial: previa.credencial,
          endereco: previa.endereco,
          chave: p.chave,
        });
        if (!teste.ok) return resposta.code(422).send({ code: "CHAVE_RECUSADA", message: teste.erro });
        modelos = teste.modelos;
        guardar = teste.credencialNova ?? p.chave;
      }
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          // O "antes" da auditoria é lido aqui, com a linha travada: duas trocas ao mesmo tempo não se confundem.
          const atual = await buscarConta(c, id, true);
          if (!atual) return null;
          const chave = guardar;
          const feita = await mudarConta(c, id, {
            ...(p.nome !== undefined ? { nome: p.nome } : {}),
            ...(p.tetoMensal !== undefined ? { tetoMensal: p.tetoMensal } : {}),
            ...(chave !== null
              ? {
                  chaveCifrada: await (cofre as Cofre).guardarChaveDeIa(c, sessao.empresaId, id, chave),
                  finalDaChave: finalDaCredencial(atual.provedor, chave),
                }
              : {}),
          });
          if (modelos) await acertarModelos(c, id, modelos);
          return { atual, conta: feita };
        });
        if (!feito) return naoEncontrada(resposta);
        const { atual, conta } = feito;
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
        const mudou = (["nome", "tetoMensal"] as const).filter((k) => atual[k] !== conta[k]);
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
          return nomeRepetido(resposta);
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
      // Um teste por conta de cada vez: o login do ChatGPT troca o token de renovação, e dois testes juntos usariam o
      // mesmo token (o segundo seria recusado e poderia derrubar o login). A trava é do PostgreSQL, então vale também
      // com mais de uma cópia da API.
      const trava = await poolApp.connect();
      try {
        const r = await trava.query<{ livre: boolean }>(
          "select pg_try_advisory_lock(hashtextextended($1, 0)) as livre",
          [`conta-de-ia:${id}`],
        );
        if (!r.rows[0]?.livre)
          return resposta.code(409).send({
            code: "TESTE_EM_ANDAMENTO",
            message: "Esta conta já está sendo testada. Tente de novo.",
          });
        try {
          return await testarConta(pedido, resposta, cofre, id);
        } finally {
          await trava.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`conta-de-ia:${id}`]);
        }
      } finally {
        trava.release();
      }
    },
  );

  async function testarConta(pedido: FastifyRequest, resposta: FastifyReply, cofre: Cofre, id: string) {
    const { sessao } = acessoDo(pedido);
    // A chave é aberta numa transação curta e o pedido ao provedor acontece fora dela.
    const aberta = await naEmpresa(pedido, async (c) => {
      const conta = await buscarConta(c, id);
      const cifrada = conta ? await chaveCifradaDaConta(c, id) : null;
      if (!conta || !cifrada) return null;
      try {
        return { conta, cifrada, chave: await cofre.abrirChaveDeIa(c, sessao.empresaId, id, cifrada) };
      } catch (erro) {
        if (!(erro instanceof ErroDoCofre)) throw erro;
        pedido.log.error({ evento: "cofre.falhou", contaId: id, motivo: erro.message }, "O cofre não abriu");
        return { conta, cifrada, chave: null };
      }
    });
    if (!aberta) return naoEncontrada(resposta);
    const teste: ResultadoDoTeste =
      aberta.chave === null
        ? { ok: false, erro: "Não foi possível abrir a chave guardada. Troque a chave desta conta." }
        : await provedores.testar({
            provedor: aberta.conta.provedor,
            credencial: aberta.conta.credencial,
            endereco: aberta.conta.endereco,
            chave: aberta.chave,
          });
    // Limite do plano não é chave errada: a conta continua ativa, só fica sem uso até a hora que o provedor disse.
    const noLimite = !teste.ok && teste.limiteAte !== undefined;
    const feito = await naEmpresa(pedido, async (c) => {
      if (!(await buscarConta(c, id, true))) return null;
      // Se a chave foi trocada durante o teste, vale a troca: a renovação do login antigo é descartada e o
      // resultado deste teste não marca a conta.
      if (teste.credencialNova) {
        const guardou = await guardarCredencialRenovada(
          c,
          id,
          aberta.cifrada,
          await cofre.guardarChaveDeIa(c, sessao.empresaId, id, teste.credencialNova),
          finalDaCredencial(aberta.conta.provedor, teste.credencialNova),
        );
        if (!guardou) return { conta: (await buscarConta(c, id)) as ContaDeIa, novos: 0 };
      } else if (!(await chaveCifradaDaConta(c, id))?.equals(aberta.cifrada)) {
        return { conta: (await buscarConta(c, id)) as ContaDeIa, novos: 0 };
      }
      await marcarTeste(c, id, teste.ok || noLimite ? null : teste.erro);
      if (aberta.conta.credencial === "assinatura")
        await marcarLimiteDoPlano(c, id, noLimite ? (teste.limiteAte ?? null) : null);
      const novos = teste.ok ? await acertarModelos(c, id, teste.modelos) : 0;
      return { conta: (await buscarConta(c, id)) as ContaDeIa, novos };
    });
    if (!feito) return naoEncontrada(resposta);
    if (noLimite)
      await registrar(
        pedido,
        "ia.chegou_no_limite_do_plano",
        { tipo: "conta_de_ia", id },
        { ate: feito.conta.limiteDoPlanoAte },
      );
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
  }

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

  // Os modelos liberados de todas as contas, para escolher o do agente.
  app.get("/ia/modelos", { preHandler: verificador.exigir("agentes", "editar") }, async (pedido) =>
    naEmpresa(pedido, async (c) => {
      const r = await c.query<{ conta_id: string; conta: string; credencial: string; modelo: string }>(
        `select m.conta_id, ct.nome as conta, ct.credencial, m.modelo
           from modelos_de_conta_de_ia m join contas_de_ia ct on ct.id = m.conta_id
          where m.empresa_id = empresa_ativa() and m.liberado and not m.sumiu
          order by lower(ct.nome), m.modelo`,
      );
      return r.rows.map((l) => ({
        contaId: l.conta_id,
        conta: l.conta,
        credencial: l.credencial,
        modelo: l.modelo,
      }));
    }),
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
          const motivo = await modeloIndisponivel(c, m, true);
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
