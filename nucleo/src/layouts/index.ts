/**
 * Layouts de painéis (M3-10): pessoais (o banco só mostra a cada pessoa os dela) e de cada empresa. A estrutura é
 * conferida pelo contrato, pelo tamanho e por só citar os painéis declarados. Não entram na auditoria (preferência
 * da pessoa, não dado da empresa).
 */
import {
  type AparelhoDoLayout,
  conferir,
  type EstruturaDoLayout,
  LAYOUTS_POR_APARELHO,
  type LayoutDeTela,
  PedidoDeLayout,
  TAMANHO_MAXIMO_DO_LAYOUT,
  TIPOS_DE_PAINEL,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";

interface Linha {
  id: string;
  empresa_id: string;
  pessoa_id: string;
  nome: string;
  aparelho: AparelhoDoLayout;
  estrutura: EstruturaDoLayout;
  usado_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "id, empresa_id, pessoa_id, nome, aparelho, estrutura, usado_em, criado_em";

const paraLayout = (l: Linha): LayoutDeTela => ({
  id: l.id,
  empresaId: l.empresa_id,
  pessoaId: l.pessoa_id,
  nome: l.nome,
  aparelho: l.aparelho,
  estrutura: l.estrutura,
  usadoEm: l.usado_em ? l.usado_em.toISOString() : null,
  criadoEm: l.criado_em.toISOString(),
});

/**
 * O problema da estrutura, ou null: tamanho, ids repetidos, favorito que não é painel, e a divisão do dockview só
 * pode citar os painéis declarados (com o tipo certo).
 */
export function problemaDaEstrutura(e: EstruturaDoLayout): string | null {
  if (Buffer.byteLength(JSON.stringify(e)) > TAMANHO_MAXIMO_DO_LAYOUT) return "O layout ficou grande demais.";
  const ids = new Set(e.paineis.map((p) => p.id));
  if (ids.size !== e.paineis.length) return "Há painéis repetidos no layout.";
  if ((e.favoritos ?? []).some((f) => !ids.has(f))) return "Favorito que não está no layout.";
  const paineis = (e.divisao as { panels?: Record<string, { contentComponent?: unknown }> } | undefined)
    ?.panels;
  if (paineis && typeof paineis === "object") {
    for (const [id, p] of Object.entries(paineis)) {
      const tipo = e.paineis.find((x) => x.id === id)?.tipo;
      if (!tipo || p?.contentComponent !== tipo || !(TIPOS_DE_PAINEL as readonly string[]).includes(tipo))
        return "A divisão cita um painel que não está no layout.";
    }
  }
  return null;
}

export function registrarRotasDosLayouts(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  // Qualquer pessoa da empresa monta os próprios painéis; cada painel confere a própria permissão ao buscar dados.
  const ver = { preHandler: verificador.exigir("tarefas", "ver") };
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }
  const invalido = (resposta: FastifyReply, mensagem: string) =>
    resposta.code(400).send({ code: "LAYOUT_INVALIDO", message: mensagem });
  const naoEncontrado = (resposta: FastifyReply) =>
    resposta.code(404).send({ code: "LAYOUT_NAO_ENCONTRADO", message: "Layout não encontrado." });
  const nomeRepetido = (erro: unknown) => (erro as { code?: string }).code === "23505";

  app.get("/layouts", ver, async (pedido) => {
    const { aparelho } = pedido.query as { aparelho?: string };
    return naEmpresa(pedido, async (c) => {
      const r = await c.query<Linha>(
        `select ${COLUNAS} from layouts_de_tela where empresa_id = empresa_ativa()
           and ($1::text is null or aparelho = $1)
         order by usado_em desc nulls last, lower(nome)`,
        [aparelho === "computador" || aparelho === "celular" ? aparelho : null],
      );
      return { layouts: r.rows.map(paraLayout) };
    });
  });

  app.post("/layouts", ver, async (pedido, resposta) => {
    const r = conferir(PedidoDeLayout, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const problema = problemaDaEstrutura(r.valor.estrutura);
    if (problema) return invalido(resposta, problema);
    try {
      const feito = await naEmpresa(pedido, async (c) => {
        const n = await c.query<{ n: string }>(
          "select count(*) as n from layouts_de_tela where empresa_id = empresa_ativa() and aparelho = $1",
          [r.valor.aparelho],
        );
        if (Number(n.rows[0]?.n ?? "0") >= LAYOUTS_POR_APARELHO) return null;
        const l = await c.query<Linha>(
          `insert into layouts_de_tela (empresa_id, pessoa_id, nome, aparelho, estrutura, usado_em)
           values (empresa_ativa(), pessoa_ativa(), $1, $2, $3::jsonb, now()) returning ${COLUNAS}`,
          [r.valor.nome.trim(), r.valor.aparelho, JSON.stringify(r.valor.estrutura)],
        );
        return paraLayout(l.rows[0] as Linha);
      });
      if (!feito)
        return invalido(resposta, `Até ${LAYOUTS_POR_APARELHO} layouts por aparelho. Apague um antes.`);
      return resposta.code(201).send(feito);
    } catch (erro) {
      if (nomeRepetido(erro)) return invalido(resposta, "Já existe um layout com esse nome.");
      throw erro;
    }
  });

  // Salva por cima (o mesmo layout, depois de mexer nos painéis).
  app.post("/layouts/:id", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta);
    const r = conferir(PedidoDeLayout, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const problema = problemaDaEstrutura(r.valor.estrutura);
    if (problema) return invalido(resposta, problema);
    try {
      const feito = await naEmpresa(pedido, async (c) => {
        const l = await c.query<Linha>(
          `update layouts_de_tela set nome = $2, estrutura = $3::jsonb, usado_em = now()
            where id = $1 and empresa_id = empresa_ativa() and aparelho = $4 returning ${COLUNAS}`,
          [id, r.valor.nome.trim(), JSON.stringify(r.valor.estrutura), r.valor.aparelho],
        );
        return l.rows[0] ? paraLayout(l.rows[0]) : null;
      });
      if (!feito) return naoEncontrado(resposta);
      return feito;
    } catch (erro) {
      if (nomeRepetido(erro)) return invalido(resposta, "Já existe um layout com esse nome.");
      throw erro;
    }
  });

  // Trocar de layout: marca como o último usado (é ele que abre sozinho da próxima vez).
  app.post("/layouts/:id/usar", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta);
    const feito = await naEmpresa(pedido, async (c) => {
      const l = await c.query<Linha>(
        `update layouts_de_tela set usado_em = now() where id = $1 and empresa_id = empresa_ativa() returning ${COLUNAS}`,
        [id],
      );
      return l.rows[0] ? paraLayout(l.rows[0]) : null;
    });
    if (!feito) return naoEncontrado(resposta);
    return feito;
  });

  app.delete("/layouts/:id", ver, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta);
    const apagou = await naEmpresa(pedido, async (c) => {
      const r = await c.query("delete from layouts_de_tela where id = $1 and empresa_id = empresa_ativa()", [
        id,
      ]);
      return (r.rowCount ?? 0) > 0;
    });
    if (!apagou) return naoEncontrado(resposta);
    return resposta.code(204).send();
  });
}
