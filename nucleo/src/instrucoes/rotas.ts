/**
 * Rotas das instruções em camadas e das skills (M4-05, decisão 0027). Módulo de permissão "instrucoes": todos veem;
 * editar as camadas da empresa e dos agentes, criar e atribuir skills é "editar" e "criar"; publicar é "aprovar"
 * (padrão: o administrador). A camada de um projeto é do diretor dele ou de quem edita todos os projetos.
 */
import {
  CAMADAS_DA_EMPRESA,
  type CamadaDaEmpresa,
  conferir,
  PedidoDeInstrucoes,
  PedidoDeSkill,
  PedidoDeSkillsDoAgente,
  PedidoDeVoltarVersao,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { FORMATO_UUID } from "../comum.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  criarSkill,
  definirSkillsDoAgente,
  idsDasSkillsDoAgente,
  listarSkills,
  listarVersoes,
  montarInstrucoes,
  publicarSkill,
  salvarInstrucoes,
  salvarRascunho,
  versaoDaCamada,
  versoesDaSkill,
} from "./servico.ts";

const naoEncontrado = (r: FastifyReply, o: string) =>
  r.code(404).send({ code: "NAO_ENCONTRADO", message: `${o} não encontrado.` });
const invalido = (r: FastifyReply, problemas: unknown) =>
  r.code(400).send({ code: "PEDIDO_INVALIDO", problemas });

export function registrarRotasDasInstrucoes(
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
    acao: string,
    alvo: { tipo: string; id: string },
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
  const pode = (pedido: FastifyRequest, acao: "criar" | "editar" | "aprovar") =>
    (acessoDo(pedido).permissoes.modulos.get("instrucoes")?.acoes[acao] ?? "nada") !== "nada";

  /**
   * A camada pedida existe e a pessoa pode editá-la? empresa: editar instruções; agente: o agente existe e a pessoa
   * edita instruções; projeto: o projeto existe e a pessoa é a diretora ou edita todos os projetos.
   */
  async function conferirCamada(
    c: pg.PoolClient,
    pedido: FastifyRequest,
    camada: string,
    alvoId: string | null,
  ): Promise<{ erro: 404 } | { camada: CamadaDaEmpresa; alvoId: string | null; podeEditar: boolean }> {
    if (!(CAMADAS_DA_EMPRESA as readonly string[]).includes(camada)) return { erro: 404 };
    const c2 = camada as CamadaDaEmpresa;
    if (c2 === "empresa")
      return alvoId ? { erro: 404 } : { camada: c2, alvoId: null, podeEditar: pode(pedido, "editar") };
    if (!alvoId || !FORMATO_UUID.test(alvoId)) return { erro: 404 };
    if (c2 === "agente") {
      const a = await c.query("select 1 from agentes where id = $1 and empresa_id = empresa_ativa()", [
        alvoId,
      ]);
      return (a.rowCount ?? 0) === 0
        ? { erro: 404 }
        : { camada: c2, alvoId, podeEditar: pode(pedido, "editar") };
    }
    const p = await c.query<{ diretor_id: string | null }>(
      "select diretor_id from projetos where id = $1 and empresa_id = empresa_ativa()",
      [alvoId],
    );
    if (!p.rows[0]) return { erro: 404 };
    const { sessao, permissoes } = acessoDo(pedido);
    const editaTodos = permissoes.modulos.get("projetos")?.acoes.editar === "tudo";
    return { camada: c2, alvoId, podeEditar: editaTodos || p.rows[0].diretor_id === sessao.pessoa.id };
  }

  const camadaDo = (pedido: FastifyRequest) => {
    const p = pedido.params as { camada: string; alvoId?: string };
    return { camada: p.camada, alvoId: p.alvoId ?? null };
  };

  const verCamada = async (pedido: FastifyRequest, resposta: FastifyReply) => {
    const { camada, alvoId } = camadaDo(pedido);
    const feito = await naEmpresa(pedido, async (c) => {
      const conferida = await conferirCamada(c, pedido, camada, alvoId);
      if ("erro" in conferida) return null;
      const versoes = await listarVersoes(c, conferida.camada, conferida.alvoId);
      return { atual: versoes[0] ?? null, versoes, podeEditar: conferida.podeEditar };
    });
    return feito ?? naoEncontrado(resposta, "Camada");
  };

  const salvarCamada = async (pedido: FastifyRequest, resposta: FastifyReply, voltar: boolean) => {
    const { camada, alvoId } = camadaDo(pedido);
    const r = voltar
      ? conferir(PedidoDeVoltarVersao, pedido.body)
      : conferir(PedidoDeInstrucoes, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const { sessao } = acessoDo(pedido);
    const feito = await naEmpresa(pedido, async (c) => {
      const conferida = await conferirCamada(c, pedido, camada, alvoId);
      if ("erro" in conferida) return { erro: 404 as const };
      if (!conferida.podeEditar) return { erro: 403 as const };
      let texto: string;
      let voltouDe: number | null = null;
      if (voltar) {
        const versao = (r.valor as { versao: number }).versao;
        const alvo = await versaoDaCamada(c, conferida.camada, conferida.alvoId, versao);
        if (!alvo) return { erro: 404 as const };
        texto = alvo.texto;
        voltouDe = versao;
      } else texto = (r.valor as { texto: string }).texto;
      return {
        versao: await salvarInstrucoes(
          c,
          conferida.camada,
          conferida.alvoId,
          texto,
          sessao.pessoa.id,
          voltouDe,
        ),
      };
    });
    if ("erro" in feito) {
      if (feito.erro === 404) return naoEncontrado(resposta, voltar ? "Versão" : "Camada");
      return resposta
        .code(403)
        .send({ code: "SEM_PERMISSAO", message: "Você não pode editar as instruções desta camada." });
    }
    await registrar(
      pedido,
      voltar ? "instrucoes.voltou_versao" : "instrucoes.editou",
      { tipo: "instrucoes", id: feito.versao.id },
      { camada, alvoId, versao: feito.versao.versao, ...(voltar ? { voltouDe: feito.versao.voltouDe } : {}) },
    );
    return feito.versao;
  };

  const ver = { preHandler: verificador.exigir("instrucoes", "ver") };
  app.get("/instrucoes/:camada", ver, verCamada);
  app.get("/instrucoes/:camada/:alvoId", ver, verCamada);
  app.post("/instrucoes/:camada", ver, (p, r) => salvarCamada(p, r, false));
  app.post("/instrucoes/:camada/:alvoId", ver, (p, r) => salvarCamada(p, r, false));
  app.post("/instrucoes/:camada/voltar", ver, (p, r) => salvarCamada(p, r, true));
  app.post("/instrucoes/:camada/:alvoId/voltar", ver, (p, r) => salvarCamada(p, r, true));

  // O texto final de um agente (com a camada do projeto da tarefa, se vier ?tarefa=).
  app.get("/agentes/:id/instrucoes", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const { tarefa } = pedido.query as { tarefa?: string };
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Agente");
    const feito = await naEmpresa(pedido, async (c) => {
      const a = await c.query("select 1 from agentes where id = $1 and empresa_id = empresa_ativa()", [id]);
      if ((a.rowCount ?? 0) === 0) return null;
      return montarInstrucoes(c, id, tarefa && FORMATO_UUID.test(tarefa) ? tarefa : null);
    });
    return feito ?? naoEncontrado(resposta, "Agente");
  });

  // Skills ------------------------------------------------------------------------------------------------------

  app.get("/skills", ver, (pedido) => naEmpresa(pedido, (c) => listarSkills(c)));

  app.get("/skills/:id", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const feito = await naEmpresa(pedido, async (c) => {
      const versoes = await versoesDaSkill(c, id);
      if (!versoes) return null;
      const skill = (await listarSkills(c)).find((s) => s.id === id);
      return skill ? { skill, versoes } : null;
    });
    return feito ?? naoEncontrado(resposta, "Skill");
  });

  app.post("/skills", { preHandler: verificador.exigir("instrucoes", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeSkill, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const { sessao } = acessoDo(pedido);
    const id = await naEmpresa(pedido, (c) => criarSkill(c, r.valor, sessao.pessoa.id));
    if (!id)
      return resposta.code(409).send({ code: "NOME_EM_USO", message: "Já existe uma skill com esse nome." });
    await registrar(pedido, "skill.criou", { tipo: "skill", id }, { nome: r.valor.nome });
    return resposta.code(201).send({ id });
  });

  app.post(
    "/skills/:id/rascunho",
    { preHandler: verificador.exigir("instrucoes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeSkill, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = (await listarSkills(c)).find((s) => s.id === id && s.origem === "empresa");
        if (!atual) return { erro: 404 as const };
        if (atual.nome !== r.valor.nome) return { erro: 400 as const };
        await salvarRascunho(c, id, r.valor, sessao.pessoa.id);
        return { ok: true as const };
      });
      if ("erro" in feito) {
        if (feito.erro === 404) return naoEncontrado(resposta, "Skill");
        return resposta.code(400).send({ code: "NOME_FIXO", message: "O nome da skill não muda." });
      }
      await registrar(pedido, "skill.editou_rascunho", { tipo: "skill", id });
      return { ok: true };
    },
  );

  app.post(
    "/skills/:id/publicar",
    { preHandler: verificador.exigir("instrucoes", "aprovar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const versao = await naEmpresa(pedido, (c) => publicarSkill(c, id));
      if (versao === "nao_existe") return naoEncontrado(resposta, "Skill");
      if (!versao)
        return resposta
          .code(409)
          .send({ code: "SEM_RASCUNHO", message: "Esta skill não tem rascunho para publicar." });
      await registrar(pedido, "skill.publicou", { tipo: "skill", id }, { versao });
      return { versao };
    },
  );

  app.get("/agentes/:id/skills", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Agente");
    const feito = await naEmpresa(pedido, async (c) => {
      const a = await c.query("select 1 from agentes where id = $1 and empresa_id = empresa_ativa()", [id]);
      if ((a.rowCount ?? 0) === 0) return null;
      return idsDasSkillsDoAgente(c, id);
    });
    return feito ?? naoEncontrado(resposta, "Agente");
  });

  app.post(
    "/agentes/:id/skills",
    { preHandler: verificador.exigir("instrucoes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeSkillsDoAgente, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Agente");
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const a = await c.query(
          "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and situacao <> 'desligado'",
          [id],
        );
        if ((a.rowCount ?? 0) === 0) return null;
        return definirSkillsDoAgente(c, id, r.valor.skills, sessao.pessoa.id);
      });
      if (!feito) return naoEncontrado(resposta, "Agente");
      if ("desconhecida" in feito)
        return resposta.code(400).send({ code: "SKILL_DESCONHECIDA", message: "Uma das skills não existe." });
      await registrar(pedido, "skill.atribuiu", { tipo: "agente", id }, feito);
      return feito.depois;
    },
  );
}
