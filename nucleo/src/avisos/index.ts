/**
 * Avisos para uma pessoa dentro do Mago OS (M2-04): o agente dela ficou sem sinal, passou do limite ou foi
 * desligado. Aparecem no Início até ela marcar como lido. O e-mail vai junto, pelo carteiro.
 */
import type { Aviso, TipoDeAviso } from "@mago-os/contratos";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Carteiro } from "../acesso/login.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";

interface LinhaDoAviso {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  tipo: TipoDeAviso;
  texto: string;
  link: string;
  criado_em: Date;
  lido_em: Date | null;
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
    `insert into avisos (empresa_id, pessoa_id, tipo, texto, link)
     select empresa_ativa(), $1, $2, $3, $4
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
  const contato = await c.query<{ nome: string; email: string }>(
    "select nome, email from pessoas where id = $1",
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
      })
      .catch((erro) => log.error({ erro }, "Aviso de agente: o e-mail não saiu"));
  };
}

/** Rotas da própria pessoa: os avisos não lidos e marcar como lido. Qualquer perfil (todos veem agentes). */
export function registrarRotasDosAvisos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  app.get("/avisos", { preHandler: verificador.exigir("agentes", "ver") }, async (pedido) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const r = await c.query<LinhaDoAviso>(
        `select id, empresa_id, pessoa_id, tipo, texto, link, criado_em, lido_em from avisos
          where empresa_id = empresa_ativa() and pessoa_id = $1 and lido_em is null
          order by criado_em desc limit 50`,
        [sessao.pessoa.id],
      );
      return r.rows.map(paraAviso);
    });
  });

  app.post(
    "/avisos/:id/lido",
    { preHandler: verificador.exigir("agentes", "ver") },
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
}
