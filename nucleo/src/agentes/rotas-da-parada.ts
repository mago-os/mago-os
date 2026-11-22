/**
 * Rotas de "Parar todos os agentes" (M4-09, decisão 0031).
 *
 * - Na empresa: ver a parada ativa ("agentes.ver"), parar e retomar ("agentes.excluir", a mesma de desligar agentes:
 *   só o administrador por padrão). Parar e retomar pedem o segundo fator recente.
 * - Na plataforma: o Dono para e retoma os agentes de todas as empresas (com o segundo fator recente). A parada dele
 *   só ele retoma.
 */
import { conferir, type Parada, PedidoDeParada, PedidoDeRetomada } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import type { Login } from "../acesso/login.ts";
import { origemDoPedido, type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { paradaAtiva, pararTodos, type ResultadoDaRetomada, retomarDaParada } from "./parada.ts";

export interface OpcoesDaParada {
  verificador: Verificador;
  poolApp: pg.Pool;
  acordar(empresaId: string, execucaoId: string): void;
}

const pedeConfirmacao = (r: FastifyReply) =>
  r.code(403).send({
    code: "CONFIRMACAO_NECESSARIA",
    message:
      "Por segurança, confirme com o código do app ou com a passkey antes de parar ou retomar os agentes.",
  });

const invalido = (r: FastifyReply, problemas: unknown) =>
  r.code(400).send({ code: "PEDIDO_INVALIDO", message: "Confira os dados do pedido.", problemas });

export function respostaDaRetomada(r: FastifyReply, feito: ResultadoDaRetomada) {
  if ("erro" in feito) {
    if (feito.erro === "so_o_dono")
      return r.code(403).send({
        code: "PARADA_DA_PLATAFORMA",
        message: "Os agentes foram parados pelo Dono da plataforma. Só ele retoma.",
      });
    return r.code(409).send({
      code: feito.erro === "sem_parada" ? "SEM_PARADA" : "NADA_A_RETOMAR",
      message:
        feito.erro === "sem_parada"
          ? "Os agentes não estão parados."
          : "Esses agentes não fazem parte da parada ou já voltaram.",
    });
  }
  return null;
}

export function registrarRotasDaParada(app: FastifyInstance, o: OpcoesDaParada): void {
  const { verificador, poolApp } = o;

  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  const segundoFatorRecente = (pedido: FastifyRequest) => {
    const { sessao } = acessoDo(pedido);
    return podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo);
  };

  function registrar(
    pedido: FastifyRequest,
    acao: string,
    parada: Parada,
    detalhes: Record<string, unknown>,
  ) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "parada_de_agentes", id: parada.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }

  app.get("/agentes/parada", { preHandler: verificador.exigir("agentes", "ver") }, async (pedido) => ({
    parada: await naEmpresa(pedido, (c) => paradaAtiva(c)),
  }));

  app.post(
    "/agentes/parar-todos",
    { preHandler: verificador.exigir("agentes", "excluir") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeParada, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (!segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, (c) =>
        pararTodos(c, {
          pessoaId: sessao.pessoa.id,
          nome: sessao.pessoa.nome,
          motivo: r.valor.motivo,
          daPlataforma: false,
        }),
      );
      if (feito.jaParada)
        return resposta
          .code(409)
          .send({ code: "JA_PARADOS", message: "Os agentes já estão parados.", parada: feito.parada });
      await registrar(pedido, "agentes.parou_todos", feito.parada, {
        motivo: r.valor.motivo.trim(),
        agentes: feito.parada.agentes.length,
      });
      return resposta.code(201).send(feito.parada);
    },
  );

  app.post(
    "/agentes/retomar-todos",
    { preHandler: verificador.exigir("agentes", "excluir") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeRetomada, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (!segundoFatorRecente(pedido)) return pedeConfirmacao(resposta);
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, (c) =>
        retomarDaParada(c, {
          pessoaId: sessao.pessoa.id,
          nome: sessao.pessoa.nome,
          agenteIds: r.valor.agenteIds,
          comoDono: false,
        }),
      );
      const erro = respostaDaRetomada(resposta, feito);
      if (erro || "erro" in feito) return erro;
      await registrar(pedido, "agentes.retomou", feito.parada, {
        agentes: feito.retomados,
        terminou: feito.terminou,
      });
      for (const id of feito.acordar) o.acordar(sessao.empresaId, id);
      return feito.parada;
    },
  );
}

export interface OpcoesDaParadaDaPlataforma {
  login: Login;
  poolAcesso: pg.Pool;
  poolApp: pg.Pool;
  acordar(empresaId: string, execucaoId: string): void;
}

/** O Dono da plataforma para e retoma os agentes de todas as empresas ativas. */
export function registrarRotasDaParadaDaPlataforma(
  app: FastifyInstance,
  o: OpcoesDaParadaDaPlataforma,
): void {
  const { poolAcesso, poolApp } = o;

  async function exigirDono(pedido: FastifyRequest, resposta: FastifyReply): Promise<SessaoDoPedido | null> {
    const sessao = await sessaoDoPedido(o.login, poolAcesso, pedido);
    if (!sessao) {
      resposta.code(401).send({ code: "SEM_SESSAO", message: "Entre no Mago OS para continuar." });
      return null;
    }
    if (!sessao.estado.completa) {
      resposta
        .code(403)
        .send({ code: "DOIS_FATORES_CONFIRMAR", message: "Confirme a autenticação em 2 fatores." });
      return null;
    }
    const dono = await poolAcesso.query<{ e: boolean }>("select acesso.e_dono_da_plataforma($1) as e", [
      sessao.pessoa.id,
    ]);
    if (dono.rows[0]?.e !== true) {
      resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só o Dono da plataforma." });
      return null;
    }
    return sessao;
  }

  async function empresasAtivas(pessoaId: string): Promise<{ id: string; nome: string }[]> {
    const r = await poolAcesso.query<{ id: string; nome: string; situacao: string }>(
      "select id, nome, situacao from acesso.empresas_da_plataforma($1)",
      [pessoaId],
    );
    return r.rows.filter((e) => e.situacao === "ativa");
  }

  const auditarNaEmpresa = (
    pedido: FastifyRequest,
    sessao: SessaoDoPedido,
    empresaId: string,
    acao: string,
    parada: Parada,
    detalhes: Record<string, unknown>,
  ) =>
    auditar(
      poolApp,
      {
        empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "parada_de_agentes", id: parada.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { ...detalhes, daPlataforma: true },
      },
      pedido.log,
    );

  // As empresas com os agentes parados (para a tela Empresas do Dono).
  app.get("/plataforma/agentes/paradas", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const paradas: { empresaId: string; empresaNome: string; parada: Parada }[] = [];
    for (const e of await empresasAtivas(sessao.pessoa.id)) {
      const parada = await comEmpresa(poolApp, e.id, (c) => paradaAtiva(c));
      if (parada) paradas.push({ empresaId: e.id, empresaNome: e.nome, parada });
    }
    return { paradas };
  });

  app.post("/plataforma/agentes/parar-todos", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    const r = conferir(PedidoDeParada, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    if (!podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo))
      return pedeConfirmacao(resposta);
    let empresas = 0;
    let agentes = 0;
    for (const e of await empresasAtivas(sessao.pessoa.id)) {
      const feito = await comEmpresa(poolApp, e.id, (c) =>
        pararTodos(c, {
          pessoaId: sessao.pessoa.id,
          nome: sessao.pessoa.nome,
          motivo: r.valor.motivo,
          daPlataforma: true,
        }),
      );
      if (feito.jaParada) continue;
      empresas += 1;
      agentes += feito.parada.agentes.length;
      await auditarNaEmpresa(pedido, sessao, e.id, "agentes.parou_todos", feito.parada, {
        motivo: r.valor.motivo.trim(),
        agentes: feito.parada.agentes.length,
      });
    }
    return resposta.code(201).send({ empresas, agentes });
  });

  app.post("/plataforma/agentes/retomar-todos", async (pedido, resposta) => {
    const sessao = await exigirDono(pedido, resposta);
    if (!sessao) return resposta;
    if (!podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo))
      return pedeConfirmacao(resposta);
    let empresas = 0;
    let agentes = 0;
    for (const e of await empresasAtivas(sessao.pessoa.id)) {
      const feito = await comEmpresa(poolApp, e.id, (c) =>
        retomarDaParada(c, {
          pessoaId: sessao.pessoa.id,
          nome: sessao.pessoa.nome,
          agenteIds: null,
          comoDono: true,
          soDaPlataforma: true,
        }),
      );
      if ("erro" in feito) continue;
      empresas += 1;
      agentes += feito.retomados.length;
      await auditarNaEmpresa(pedido, sessao, e.id, "agentes.retomou", feito.parada, {
        agentes: feito.retomados,
        terminou: feito.terminou,
      });
      for (const id of feito.acordar) o.acordar(e.id, id);
    }
    return { empresas, agentes };
  });
}
