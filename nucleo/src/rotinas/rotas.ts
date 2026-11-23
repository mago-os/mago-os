/**
 * Rotas das rotinas (M5-05, decisão 0039). Módulo de permissão "rotinas": ver pelo alcance; só o dono edita, liga e
 * usa "Rodar agora"; o administrador (editar com alcance "tudo") desliga qualquer uma; apagar pelo alcance de
 * "excluir". Cada mudança vira evento de auditoria (sem os textos da rotina).
 */
import {
  type AcaoDeRotina,
  conferirPedidoDeEdicaoDeRotina,
  conferirPedidoDeRotina,
  type Problema,
  type Rotina,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  apagarRotina,
  buscarRotina,
  criarRotina,
  desligarRotina,
  editarRotina,
  ligarRotina,
  listarExecucoes,
  listarRotinas,
  nomesDasRotinas,
  pedirParaRodarAgora,
  RecusaDaRotina,
} from "./servico.ts";

export interface OpcoesDasRotasDasRotinas {
  verificador: Verificador;
  poolApp: pg.Pool;
  /** Roda logo a execução do "Rodar agora" (sem esperar a verificação do minuto). */
  rodarAgora(empresaId: string, execucaoId: string): void;
}

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

const naoEncontrada = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Rotina não encontrada." });

const soODono = (resposta: FastifyReply) =>
  resposta.code(403).send({
    code: "SO_O_DONO",
    message: "Só quem criou a rotina pode mudar, ligar ou rodar (ela age em nome dele).",
  });

export function registrarRotasDasRotinas(app: FastifyInstance, o: OpcoesDasRotasDasRotinas): void {
  const { verificador, poolApp } = o;
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const registrar = (pedido: FastifyRequest, acao: AcaoDeRotina, rotina: Rotina, detalhes = {}) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "rotina", id: rotina.id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: { acao: rotina.acao.tipo, ...detalhes },
      },
      pedido.log,
    );
  };
  /** O que a pessoa pode fazer com a rotina (para a tela mostrar os botões certos). */
  const podeFazer = (pedido: FastifyRequest, rotina: Rotina) => {
    const { sessao, permissoes } = acessoDo(pedido);
    const souDono = rotina.donoPessoaId === sessao.pessoa.id;
    const editar = permissoes.modulos.get("rotinas")?.acoes.editar ?? "nada";
    const excluir = permissoes.modulos.get("rotinas")?.acoes.excluir ?? "nada";
    return {
      souDono,
      podeMudar: souDono && editar !== "nada",
      podeDesligar: (souDono && editar !== "nada") || editar === "tudo",
      podeApagar: excluir === "tudo" || (souDono && excluir !== "nada"),
    };
  };
  const tratar = async <T>(resposta: FastifyReply, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDaRotina)
        return resposta.code(400).send({ code: "ROTINA_RECUSADA", message: erro.message });
      throw erro;
    }
  };

  app.get("/rotinas", { preHandler: verificador.exigir("rotinas", "ver") }, async (pedido) => {
    const { filtro, permissoes } = acessoDo(pedido);
    const r = await naEmpresa(pedido, (c) => listarRotinas(c, filtro));
    return {
      ...r,
      podeCriar: (permissoes.modulos.get("rotinas")?.acoes.criar ?? "nada") !== "nada",
      permissoes: Object.fromEntries(r.rotinas.map((x) => [x.id, podeFazer(pedido, x)])),
    };
  });

  app.get("/rotinas/:id", { preHandler: verificador.exigir("rotinas", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const { filtro } = acessoDo(pedido);
    const feito = await naEmpresa(pedido, async (c) => {
      const rotina = await buscarRotina(c, filtro, id);
      if (!rotina) return null;
      return {
        rotina,
        execucoes: await listarExecucoes(c, rotina.id),
        nomes: await nomesDasRotinas(c, [rotina]),
      };
    });
    if (!feito) return naoEncontrada(resposta);
    return { ...feito, ...podeFazer(pedido, feito.rotina) };
  });

  app.post("/rotinas", { preHandler: verificador.exigir("rotinas", "criar") }, async (pedido, resposta) => {
    const r = conferirPedidoDeRotina(pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const { sessao, permissoes } = acessoDo(pedido);
    return tratar(resposta, async () => {
      const rotina = await naEmpresa(pedido, (c) =>
        criarRotina(c, { pessoaId: sessao.pessoa.id, permissoes }, r.valor),
      );
      await registrar(pedido, "rotina.criou", rotina);
      return resposta.code(201).send(rotina);
    });
  });

  /** Busca a rotina que a pessoa vê (alcance de "ver"), travada, e confere que ela é a dona. */
  const daDona = async (pedido: FastifyRequest, c: pg.PoolClient, id: string) => {
    const { sessao, permissoes } = acessoDo(pedido);
    const ver = filtroDoAlcance(
      permissoes.modulos.get("rotinas")?.acoes.ver ?? "nada",
      sessao.pessoa.id,
      permissoes.area,
    );
    const rotina = ver ? await buscarRotina(c, ver, id, true) : null;
    if (!rotina) return { ok: false as const, erro: "nao" as const };
    if (rotina.donoPessoaId !== sessao.pessoa.id) return { ok: false as const, erro: "dono" as const };
    return { ok: true as const, rotina };
  };

  app.post(
    "/rotinas/:id",
    { preHandler: verificador.exigir("rotinas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferirPedidoDeEdicaoDeRotina(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao, permissoes } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const d = await daDona(pedido, c, id);
          if (!d.ok) return d;
          return {
            ok: true as const,
            rotina: await editarRotina(c, d.rotina, { pessoaId: sessao.pessoa.id, permissoes }, r.valor),
          };
        });
        if (!feito.ok) return feito.erro === "nao" ? naoEncontrada(resposta) : soODono(resposta);
        await registrar(pedido, "rotina.editou", feito.rotina, { campos: Object.keys(r.valor) });
        return feito.rotina;
      });
    },
  );

  app.post(
    "/rotinas/:id/ligar",
    { preHandler: verificador.exigir("rotinas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao, permissoes } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const d = await daDona(pedido, c, id);
          if (!d.ok) return d;
          const antes = d.rotina.situacao;
          return {
            ok: true as const,
            rotina: await ligarRotina(c, d.rotina, { pessoaId: sessao.pessoa.id, permissoes }),
            antes,
          };
        });
        if (!feito.ok) return feito.erro === "nao" ? naoEncontrada(resposta) : soODono(resposta);
        if (feito.antes === "desligada") await registrar(pedido, "rotina.ligou", feito.rotina);
        return feito.rotina;
      });
    },
  );

  app.post(
    "/rotinas/:id/desligar",
    { preHandler: verificador.exigir("rotinas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao, alcance } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const rotina = await buscarRotina(c, { tipo: "tudo" }, id, true);
        if (!rotina) return { erro: "nao" as const };
        // O dono desliga a dele; o administrador (editar em tudo), qualquer uma.
        if (rotina.donoPessoaId !== sessao.pessoa.id && alcance !== "tudo") return { erro: "nao" as const };
        const antes = rotina.situacao;
        return { rotina: await desligarRotina(c, rotina, "pessoa"), antes };
      });
      if ("erro" in feito) return naoEncontrada(resposta);
      if (feito.antes === "ligada")
        await registrar(pedido, "rotina.desligou", feito.rotina, {
          deOutraPessoa: feito.rotina.donoPessoaId !== sessao.pessoa.id,
        });
      return feito.rotina;
    },
  );

  app.delete(
    "/rotinas/:id",
    { preHandler: verificador.exigir("rotinas", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { filtro, sessao } = acessoDo(pedido);
      const rotina = await naEmpresa(pedido, async (c) => {
        const r = await buscarRotina(c, filtro, id, true);
        if (r) await apagarRotina(c, r.id);
        return r;
      });
      if (!rotina) return naoEncontrada(resposta);
      await registrar(pedido, "rotina.apagou", rotina, {
        deOutraPessoa: rotina.donoPessoaId !== sessao.pessoa.id,
      });
      return resposta.code(204).send();
    },
  );

  app.post(
    "/rotinas/:id/rodar",
    { preHandler: verificador.exigir("rotinas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const d = await daDona(pedido, c, id);
        if (!d.ok) return d;
        return { ok: true as const, rotina: d.rotina, execucao: await pedirParaRodarAgora(c, d.rotina.id) };
      });
      if (!feito.ok) return feito.erro === "nao" ? naoEncontrada(resposta) : soODono(resposta);
      await registrar(pedido, "rotina.rodou_agora", feito.rotina, { execucaoId: feito.execucao.id });
      o.rodarAgora(sessao.empresaId, feito.execucao.id);
      return resposta.code(202).send(feito.execucao);
    },
  );
}
