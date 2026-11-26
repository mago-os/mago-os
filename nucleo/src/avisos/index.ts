/**
 * Avisos para uma pessoa dentro do Mago OS (M2-04): o agente dela ficou sem sinal, passou do limite ou foi
 * desligado. Aparecem no Início até ela marcar como lido. O e-mail vai junto, pelo carteiro.
 */
import type { Aviso, TipoDeAviso } from "@mago-os/contratos";
import { conferir, PedidoDeAssinaturaDePush, PreferenciasDeNotificacao } from "@mago-os/contratos";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Carteiro } from "../acesso/login.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { pessoaVeTarefa, preferenciasDe, salvarPreferencias } from "./notificacoes.ts";

interface LinhaDoAviso {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  tipo: TipoDeAviso;
  texto: string;
  link: string;
  criado_em: Date;
  lido_em: Date | null;
  tarefa_id?: string | null;
}

const paraAviso = (l: LinhaDoAviso): Aviso => ({
  id: l.id,
  empresaId: l.empresa_id,
  pessoaId: l.pessoa_id,
  tipo: l.tipo,
  texto: l.texto,
  link: l.link,
  criadoEm: l.criado_em.toISOString(),
  lidoEm: l.lido_em ? l.lido_em.toISOString() : null,
});

/** Cria o aviso dentro da transação da empresa (só para quem ainda tem vínculo ativo). */
export async function criarAviso(
  c: pg.PoolClient,
  d: { pessoaId: string; tipo: TipoDeAviso; texto: string; link: string },
): Promise<void> {
  await c.query(
    `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente)
     select empresa_ativa(), $1, $2, $3, $4, true
      where exists (select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo')`,
    [d.pessoaId, d.tipo, d.texto.slice(0, 500), d.link],
  );
}

export interface AvisoDeAgente {
  agenteId: string;
  agenteNome: string;
  responsavelId: string;
  tipo: TipoDeAviso;
  /** "ficou sem sinal", "passou do limite", "foi desligado". */
  oQueAconteceu: string;
  tarefas: string[];
}

/**
 * Avisa a pessoa responsável pelo agente no Mago OS (na transação) e devolve o envio do e-mail, para rodar depois
 * do commit. Se o e-mail falhar, só registra: o aviso dentro do Mago OS já ficou.
 */
export async function avisarResponsavel(
  c: pg.PoolClient,
  a: AvisoDeAgente,
  carteiro: Carteiro,
  urlPublica: string,
  log: { error(obj: unknown, msg?: string): void },
): Promise<() => Promise<void>> {
  const link = `/agentes/${a.agenteId}`;
  const sufixo =
    a.tarefas.length === 1
      ? " 1 tarefa voltou para a fila."
      : a.tarefas.length > 1
        ? ` ${a.tarefas.length} tarefas voltaram para a fila.`
        : "";
  await criarAviso(c, {
    pessoaId: a.responsavelId,
    tipo: a.tipo,
    texto: `O agente ${a.agenteNome} ${a.oQueAconteceu}.${sufixo}`,
    link,
  });
  const contato = await c.query<{ nome: string; email: string; empresa: string | null }>(
    "select nome, email, (select e.nome from empresas e where e.id = empresa_ativa()) as empresa from pessoas where id = $1",
    [a.responsavelId],
  );
  const pessoa = contato.rows[0];
  return async () => {
    if (!pessoa || !carteiro.enviarAvisoDeAgente) return;
    await carteiro
      .enviarAvisoDeAgente({
        para: pessoa.email,
        nome: pessoa.nome,
        agente: a.agenteNome,
        oQueAconteceu: a.oQueAconteceu,
        tarefas: a.tarefas,
        link: `${new URL(urlPublica).origin}${link}`,
        ...(pessoa.empresa ? { empresa: pessoa.empresa } : {}),
      })
      .catch((erro) => log.error({ erro }, "Aviso de agente: o e-mail não saiu"));
  };
}

/**
 * Os avisos não lidos da pessoa na empresa ativa que ela ainda pode ver (o de tarefa só enquanto ela vê a tarefa), os
 * mais novos primeiro. Usado pelo sino e, empresa por empresa, pelo seletor e por "Todas as empresas" (M7-05).
 */
export async function avisosVisiveis(c: pg.PoolClient, pessoaId: string, limite = 50): Promise<Aviso[]> {
  const r = await c.query<LinhaDoAviso>(
    `select a.id, a.empresa_id, a.pessoa_id, a.tipo, a.texto, a.link, a.criado_em, a.lido_em, a.tarefa_id from avisos a
      where a.empresa_id = empresa_ativa() and a.pessoa_id = $1 and a.lido_em is null
      order by a.criado_em desc limit $2`,
    [pessoaId, Math.ceil(limite * 1.6)],
  );
  const visiveis: LinhaDoAviso[] = [];
  for (const l of r.rows) {
    if (!l.tarefa_id || (await pessoaVeTarefa(c, pessoaId, l.tarefa_id))) visiveis.push(l);
    if (visiveis.length >= limite) break;
  }
  return visiveis.map(paraAviso);
}

/** Rotas da própria pessoa: os avisos não lidos e marcar como lido. Qualquer perfil (todos veem agentes). */
export function registrarRotasDosAvisos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
  /** Chave pública do push (M3-06); nulo: push desligado neste ambiente. */
  chavePublicaDoPush: string | null = null,
): void {
  app.get("/avisos", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) => avisosVisiveis(c, sessao.pessoa.id));
  });

  app.post(
    "/avisos/:id/lido",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta.code(404).send({ code: "AVISO_NAO_ENCONTRADO" });
      const feito = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
        const r = await c.query(
          `update avisos set lido_em = now()
          where id = $1 and empresa_id = empresa_ativa() and pessoa_id = $2 and lido_em is null`,
          [id, sessao.pessoa.id],
        );
        return (r.rowCount ?? 0) > 0;
      });
      return feito ? { ok: true } : resposta.code(404).send({ code: "AVISO_NAO_ENCONTRADO" });
    },
  );

  app.post("/avisos/lidos", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
      c.query(
        "update avisos set lido_em = now() where empresa_id = empresa_ativa() and pessoa_id = $1 and lido_em is null",
        [sessao.pessoa.id],
      ),
    );
    return { ok: true };
  });

  // Notificações (M3-06): a chave pública do push, se o push está ligado neste aparelho, e as preferências.
  app.get("/notificacoes", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const ligado = sessao.aparelhoId
        ? await c.query(
            "select 1 from assinaturas_de_push where empresa_id = empresa_ativa() and pessoa_id = $1 and aparelho_id = $2",
            [sessao.pessoa.id, sessao.aparelhoId],
          )
        : { rowCount: 0 };
      return {
        chavePublica: chavePublicaDoPush,
        pushNesteAparelho: (ligado.rowCount ?? 0) > 0,
        preferencias: await preferenciasDe(c, sessao.pessoa.id),
      };
    });
  });

  const registrarPush = (
    pedido: FastifyRequest,
    acao: "push.ligou" | "push.desligou" | "notificacoes.mudou_preferencias",
  ) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: sessao.aparelhoId ? { tipo: "aparelho", id: sessao.aparelhoId } : null,
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes: {},
      },
      pedido.log,
    );
  };

  app.post(
    "/notificacoes/push",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeAssinaturaDePush, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const { sessao } = acessoDo(pedido);
      if (!chavePublicaDoPush) {
        return resposta
          .code(409)
          .send({ code: "PUSH_DESLIGADO", message: "O push ainda não está ligado neste ambiente." });
      }
      if (!sessao.aparelhoId) {
        return resposta
          .code(409)
          .send({ code: "SEM_APARELHO", message: "Entre de novo neste aparelho para ligar o push." });
      }
      await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
        c.query(
          `insert into assinaturas_de_push (empresa_id, pessoa_id, aparelho_id, endpoint, p256dh, auth)
         values (empresa_ativa(), $1, $2, $3, $4, $5)
         on conflict (empresa_id, pessoa_id, aparelho_id)
           do update set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, criada_em = now()`,
          [sessao.pessoa.id, sessao.aparelhoId, r.valor.endpoint, r.valor.chaves.p256dh, r.valor.chaves.auth],
        ),
      );
      await registrarPush(pedido, "push.ligou");
      return resposta.code(201).send({ ok: true });
    },
  );

  app.delete("/notificacoes/push", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
      c.query(
        "delete from assinaturas_de_push where empresa_id = empresa_ativa() and pessoa_id = $1 and aparelho_id = $2",
        [sessao.pessoa.id, sessao.aparelhoId],
      ),
    );
    await registrarPush(pedido, "push.desligou");
    return { ok: true };
  });

  app.post(
    "/notificacoes/preferencias",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PreferenciasDeNotificacao, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const { sessao } = acessoDo(pedido);
      await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, (c) =>
        salvarPreferencias(c, sessao.pessoa.id, r.valor),
      );
      await registrarPush(pedido, "notificacoes.mudou_preferencias");
      return r.valor;
    },
  );
}
