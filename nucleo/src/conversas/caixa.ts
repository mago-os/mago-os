/**
 * Caixa única (M8-04, decisão 0054): assumir, passar, devolver ao agente, resolver e reabrir (permissão
 * `conversas.editar`), a nota interna com @ (`conversas.criar`), "está respondendo", o número das que esperam a equipe,
 * as respostas prontas (todos que respondem usam; o administrador e o gestor cuidam) e as visões salvas. Cada ação na
 * auditoria, só com ids.
 */
import {
  type ConversaComContato,
  conferir,
  PedidoDeNotaNaConversa,
  PedidoDePassarConversa,
  PedidoDeRespostaPronta,
  PedidoDeVisaoDeConversas,
  type Problema,
  type RespostaPronta,
  type VisaoDeConversas,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comPessoa } from "../empresa.ts";
import { idsForaDaEmpresa, uuidsDe } from "../ids-da-empresa.ts";
import { catalogoDeModulos } from "../permissoes/modulos.ts";
import { acessoDo, permissoesNaEmpresa, type Verificador } from "../permissoes/verificar.ts";
import {
  type AcaoNasConversas,
  buscarConversa,
  condicaoDasConversas,
  type QuemOlhaConversas,
  quemOlhaConversas,
  RecusaDasConversas,
  resolverConversa,
} from "./servico.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

const naoEncontrada = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Conversa não encontrada." });

/**
 * A pessoa vê as conversas do canal pelo alcance dela (sem contar as de que é dona): tudo; ou equipe, com o canal
 * sem equipe ou da área dela. Quem só vê as suas ("meus") não recebe conversa de canal que não vê.
 */
async function vePeloCanal(c: pg.PoolClient, q: QuemOlhaConversas, canalId: string): Promise<boolean> {
  if (q.alcance === "tudo") return true;
  if (q.alcance !== "equipe") return false;
  const r = await c.query<{ area: string | null }>(
    "select area from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
    [canalId],
  );
  const area = r.rows[0]?.area;
  return area === null || (area !== undefined && area === q.area);
}

export function registrarRotasDaCaixa(
  app: FastifyInstance,
  o: { verificador: Verificador; poolApp: pg.Pool },
): void {
  const { verificador, poolApp } = o;
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const olha = (pedido: FastifyRequest, acao: AcaoNasConversas) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemOlhaConversas(permissoes, sessao.pessoa.id, acao);
  };
  const registrar = (
    pedido: FastifyRequest,
    acao: string,
    alvo: { tipo: string; id: string },
    detalhes: Record<string, unknown> = {},
  ) => {
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
  };
  const tratar = async <T>(resposta: FastifyReply, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDasConversas)
        return resposta.code(400).send({ code: "CONVERSA_RECUSADA", message: erro.message });
      throw erro;
    }
  };

  /** Uma ação na conversa que a pessoa pode editar; devolve a conversa como ficou. */
  const acao = (
    caminho: string,
    nome: string,
    fazer: (
      c: pg.PoolClient,
      conversa: ConversaComContato,
      pedido: FastifyRequest,
    ) => Promise<Record<string, unknown> | void>,
    conferirCorpo?: (corpo: unknown) => { ok: true } | { ok: false; problemas: Problema[] },
  ) =>
    app.post(
      `/conversas-com-contatos/:id/${caminho}`,
      { preHandler: verificador.exigir("conversas", "editar") },
      async (pedido, resposta) => {
        const { id } = pedido.params as { id: string };
        if (conferirCorpo) {
          const r = conferirCorpo(pedido.body);
          if (!r.ok) return invalido(resposta, r.problemas);
        }
        return tratar(resposta, async () => {
          const feito = await naEmpresa(pedido, async (c) => {
            const conversa = await buscarConversa(c, [olha(pedido, "editar")], id, true);
            if (!conversa) return null;
            const detalhes = (await fazer(c, conversa, pedido)) ?? {};
            return { detalhes, conversa: await buscarConversa(c, [olha(pedido, "ver")], id) };
          });
          if (!feito) return naoEncontrada(resposta);
          await registrar(pedido, nome, { tipo: "conversa", id }, feito.detalhes);
          return { conversa: feito.conversa };
        });
      },
    );

  acao("assumir", "conversa.assumiu", async (c, conversa, pedido) => {
    await c.query(
      "update conversas_com_contatos set dono_id = $2, com_agente = false where id = $1 and empresa_id = empresa_ativa()",
      [conversa.id, acessoDo(pedido).sessao.pessoa.id],
    );
  });

  acao(
    "passar",
    "conversa.passou",
    async (c, conversa, pedido) => {
      const { pessoaId } = pedido.body as { pessoaId: string };
      const { sessao } = acessoDo(pedido);
      const permissoes = await permissoesNaEmpresa(poolApp, pessoaId, sessao.empresaId, catalogoDeModulos());
      if (!permissoes) throw new RecusaDasConversas("Escolha uma pessoa ativa da empresa.");
      if (!(await vePeloCanal(c, quemOlhaConversas(permissoes, pessoaId, "ver"), conversa.canal.id)))
        throw new RecusaDasConversas("Essa pessoa não vê as conversas deste canal.");
      await c.query(
        "update conversas_com_contatos set dono_id = $2, com_agente = false where id = $1 and empresa_id = empresa_ativa()",
        [conversa.id, pessoaId],
      );
      if (pessoaId !== sessao.pessoa.id)
        await criarAviso(c, {
          pessoaId,
          tipo: "mensagem_na_conversa",
          texto: `${sessao.pessoa.nome} passou para você a conversa de "${conversa.contatoNome}".`,
          link: `/conversas/${conversa.id}`,
        });
      return { para: pessoaId };
    },
    (corpo) => conferir(PedidoDePassarConversa, corpo),
  );

  acao("devolver", "conversa.devolveu", async (c, conversa) => {
    const canal = await c.query<{ agente_id: string | null }>(
      "select agente_id from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
      [conversa.canal.id],
    );
    if (!canal.rows[0]?.agente_id) throw new RecusaDasConversas("Este canal ainda não tem um agente.");
    if (conversa.situacao === "resolvida") throw new RecusaDasConversas("Reabra a conversa antes.");
    await c.query(
      "update conversas_com_contatos set dono_id = null, com_agente = true where id = $1 and empresa_id = empresa_ativa()",
      [conversa.id],
    );
  });

  acao("resolver", "conversa.resolveu", async (c, conversa, pedido) => {
    if (conversa.situacao === "resolvida") throw new RecusaDasConversas("A conversa já está resolvida.");
    await resolverConversa(c, conversa.id, acessoDo(pedido).sessao.pessoa.id);
  });

  acao("reabrir", "conversa.reabriu", async (c, conversa) => {
    if (conversa.situacao !== "resolvida") throw new RecusaDasConversas("A conversa não está resolvida.");
    const nova = await c.query(
      `select 1 from conversas_com_contatos where empresa_id = empresa_ativa() and canal_id = $1 and contato_id = $2
          and id <> $3 and (situacao <> 'resolvida' or aberta_em > $4)`,
      [conversa.canal.id, conversa.contatoId, conversa.id, conversa.abertaEm],
    );
    if ((nova.rowCount ?? 0) > 0)
      throw new RecusaDasConversas("Já existe uma conversa mais nova com este contato neste canal.");
    await c.query(
      `update conversas_com_contatos set situacao = 'aberta', resolvida_em = null, resolvida_por = null
        where id = $1 and empresa_id = empresa_ativa()`,
      [conversa.id],
    );
  });

  // Nota interna: só a equipe vê; o @ avisa quem pode ver a conversa.
  app.post(
    "/conversas-com-contatos/:id/notas",
    { preHandler: verificador.exigir("conversas", "criar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeNotaNaConversa, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const conversa = await buscarConversa(c, [olha(pedido, "criar")], id);
        if (!conversa) return null;
        const m = await c.query<{ id: string }>(
          `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, autor_pessoa_id, tipo, texto)
           values (empresa_ativa(), $1, $2, 'interna', 'pessoa', $3, 'nota', $4) returning id`,
          [id, conversa.canal.id, sessao.pessoa.id, r.valor.texto.trim()],
        );
        const avisadas: string[] = [];
        for (const pessoaId of r.valor.mencoes ?? []) {
          if (pessoaId === sessao.pessoa.id) continue;
          const permissoes = await permissoesNaEmpresa(
            poolApp,
            pessoaId,
            sessao.empresaId,
            catalogoDeModulos(),
          );
          if (!permissoes) continue;
          if (!(await buscarConversa(c, [quemOlhaConversas(permissoes, pessoaId, "ver")], id))) continue;
          await criarAviso(c, {
            pessoaId,
            tipo: "mencao_em_conversa",
            texto: `${sessao.pessoa.nome} chamou você numa nota da conversa de "${conversa.contatoNome}".`,
            link: `/conversas/${id}`,
          });
          avisadas.push(pessoaId);
        }
        return { mensagemId: m.rows[0]?.id as string, avisadas };
      });
      if (!feito) return naoEncontrada(resposta);
      await registrar(
        pedido,
        "conversa.anotou",
        { tipo: "conversa", id },
        {
          mensagemId: feito.mensagemId,
          mencoes: feito.avisadas,
        },
      );
      return resposta.code(201).send(feito);
    },
  );

  // "Está respondendo": só os ids, para as telas da mesma empresa (a tela manda no máximo a cada 5 segundos).
  app.post(
    "/conversas-com-contatos/:id/digitando",
    { preHandler: verificador.exigir("conversas", "criar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const ok = await naEmpresa(pedido, async (c) => {
        if (!(await buscarConversa(c, [olha(pedido, "criar")], id))) return false;
        await c.query("select pg_notify('mago_mudancas', $1)", [
          JSON.stringify({ empresaId: sessao.empresaId, tipo: "digitando", id, pessoaId: sessao.pessoa.id }),
        ]);
        return true;
      });
      if (!ok) return naoEncontrada(resposta);
      return { ok: true };
    },
  );

  // O número no menu: as conversas esperando a equipe que a pessoa vê.
  app.get(
    "/conversas-com-contatos-contador",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido) =>
      naEmpresa(pedido, async (c) => {
        const valores: unknown[] = [];
        const alcance = condicaoDasConversas([olha(pedido, "ver")], valores);
        const r = await c.query<{ n: number }>(
          `select count(*)::int as n from conversas_com_contatos cv
           join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
          where cv.empresa_id = empresa_ativa() and cv.situacao = 'esperando_equipe' and ${alcance}`,
          valores,
        );
        return { esperandoEquipe: r.rows[0]?.n ?? 0 };
      }),
  );

  // Respostas prontas: todos que respondem veem; o administrador e o gestor (editar com alcance "tudo") cuidam.
  const cuida = (pedido: FastifyRequest) => olha(pedido, "editar").alcance === "tudo";
  const semPermissao = (resposta: FastifyReply) =>
    resposta.code(403).send({
      code: "SEM_PERMISSAO",
      message: "Só o administrador e o gestor cuidam das respostas prontas.",
    });
  const paraResposta = (l: { id: string; nome: string; texto: string }): RespostaPronta => ({
    id: l.id,
    nome: l.nome,
    texto: l.texto,
  });
  const repetida = (erro: unknown) =>
    (erro as { constraint?: string }).constraint === "respostas_prontas_nome_unico";

  app.get("/respostas-prontas", { preHandler: verificador.exigir("conversas", "criar") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({
      respostas: (
        await c.query<{ id: string; nome: string; texto: string }>(
          "select id, nome, texto from respostas_prontas where empresa_id = empresa_ativa() order by nome",
        )
      ).rows.map(paraResposta),
      podeCuidar: cuida(pedido),
    })),
  );

  app.post(
    "/respostas-prontas",
    { preHandler: verificador.exigir("conversas", "editar") },
    async (pedido, resposta) => {
      if (!cuida(pedido)) return semPermissao(resposta);
      const r = conferir(PedidoDeRespostaPronta, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      try {
        const feita = await naEmpresa(pedido, async (c) =>
          paraResposta(
            (
              await c.query<{ id: string; nome: string; texto: string }>(
                `insert into respostas_prontas (empresa_id, nome, texto, criada_por) values (empresa_ativa(), $1, $2, $3)
               returning id, nome, texto`,
                [r.valor.nome, r.valor.texto.trim(), sessao.pessoa.id],
              )
            ).rows[0] as { id: string; nome: string; texto: string },
          ),
        );
        await registrar(pedido, "resposta_pronta.criou", { tipo: "resposta_pronta", id: feita.id });
        return resposta.code(201).send({ resposta: feita });
      } catch (erro) {
        if (repetida(erro))
          return resposta
            .code(400)
            .send({ code: "REPETIDA", message: "Já existe uma resposta com esse atalho." });
        throw erro;
      }
    },
  );

  app.post(
    "/respostas-prontas/:id",
    { preHandler: verificador.exigir("conversas", "editar") },
    async (pedido, resposta) => {
      if (!cuida(pedido)) return semPermissao(resposta);
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeRespostaPronta, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      try {
        const feita = await naEmpresa(pedido, async (c) => {
          const l = await c.query<{ id: string; nome: string; texto: string }>(
            `update respostas_prontas set nome = $2, texto = $3, atualizada_em = now()
              where id = $1 and empresa_id = empresa_ativa() returning id, nome, texto`,
            [UUID.test(id) ? id : null, r.valor.nome, r.valor.texto.trim()],
          );
          return l.rows[0] ? paraResposta(l.rows[0]) : null;
        });
        if (!feita)
          return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Resposta não encontrada." });
        await registrar(pedido, "resposta_pronta.editou", { tipo: "resposta_pronta", id });
        return { resposta: feita };
      } catch (erro) {
        if (repetida(erro))
          return resposta
            .code(400)
            .send({ code: "REPETIDA", message: "Já existe uma resposta com esse atalho." });
        throw erro;
      }
    },
  );

  app.delete(
    "/respostas-prontas/:id",
    { preHandler: verificador.exigir("conversas", "editar") },
    async (pedido, resposta) => {
      if (!cuida(pedido)) return semPermissao(resposta);
      const { id } = pedido.params as { id: string };
      const ok = await naEmpresa(pedido, async (c) => {
        const r = await c.query(
          "delete from respostas_prontas where id = $1 and empresa_id = empresa_ativa()",
          [UUID.test(id) ? id : null],
        );
        return (r.rowCount ?? 0) > 0;
      });
      if (!ok)
        return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Resposta não encontrada." });
      await registrar(pedido, "resposta_pronta.apagou", { tipo: "resposta_pronta", id });
      return { ok: true };
    },
  );

  // Visões salvas da caixa (como as dos contatos): o banco só mostra a cada pessoa as dela.
  type LinhaDaVisao = {
    id: string;
    empresa_id: string;
    pessoa_id: string;
    nome: string;
    filtro: VisaoDeConversas["filtro"];
    criada_em: Date;
  };
  const paraVisao = (l: LinhaDaVisao): VisaoDeConversas => ({
    id: l.id,
    empresaId: l.empresa_id,
    pessoaId: l.pessoa_id,
    nome: l.nome,
    filtro: l.filtro,
    criadaEm: l.criada_em.toISOString(),
  });

  app.get("/conversas-visoes", { preHandler: verificador.exigir("conversas", "ver") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({
      visoes: (
        await c.query<LinhaDaVisao>(
          `select id, empresa_id, pessoa_id, nome, filtro, criada_em from visoes_de_conversas
            where empresa_id = empresa_ativa() order by lower(nome), id`,
        )
      ).rows.map(paraVisao),
    })),
  );

  app.post(
    "/conversas-visoes",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeVisaoDeConversas, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const feita = await naEmpresa(pedido, async (c) => {
        if ((await idsForaDaEmpresa(c, uuidsDe(r.valor.filtro))).length > 0) return null;
        const l = await c.query<LinhaDaVisao>(
          `insert into visoes_de_conversas (empresa_id, pessoa_id, nome, filtro)
         values (empresa_ativa(), pessoa_ativa(), $1, $2)
         on conflict (empresa_id, pessoa_id, lower(nome)) do update set filtro = excluded.filtro
         returning id, empresa_id, pessoa_id, nome, filtro, criada_em`,
          [r.valor.nome.trim(), JSON.stringify(r.valor.filtro)],
        );
        return paraVisao(l.rows[0] as LinhaDaVisao);
      });
      if (!feita)
        return resposta
          .code(400)
          .send({ code: "PEDIDO_INVALIDO", message: "O filtro cita algo que não existe nesta empresa." });
      return resposta.code(201).send(feita);
    },
  );

  app.delete(
    "/conversas-visoes/:id",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const ok = await naEmpresa(pedido, async (c) => {
        const r = await c.query(
          "delete from visoes_de_conversas where id = $1 and empresa_id = empresa_ativa()",
          [UUID.test(id) ? id : null],
        );
        return (r.rowCount ?? 0) > 0;
      });
      if (!ok) return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Visão não encontrada." });
      return { ok: true };
    },
  );
}
