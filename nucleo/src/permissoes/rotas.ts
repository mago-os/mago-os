/**
 * Rotas do núcleo que usam as permissões (M1-06): as pessoas da empresa (cada um vê conforme o alcance) e o
 * ajuste de permissão pelo administrador. As telas chegam na M1-10.
 */
import { conferirPedidoDeAjuste } from "@mago-os/contratos";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, permissoesNaEmpresa, type Verificador } from "./verificar.ts";

export function registrarRotasDePermissoes(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  // As pessoas da empresa ativa, filtradas pelo alcance de "pessoas.ver". E-mail é dado pessoal: só com a
  // liberação de dados sensíveis.
  app.get("/empresa/pessoas", { preHandler: verificador.exigir("pessoas", "ver") }, async (pedido) => {
    const { sessao, filtro, verSensiveis } = acessoDo(pedido);
    const linhas = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const condicao =
        filtro.tipo === "tudo"
          ? { sql: "true", valores: [] as string[] }
          : filtro.tipo === "equipe"
            ? { sql: "(v.area = $1 or p.id = $2)", valores: [filtro.area, filtro.pessoaId] }
            : { sql: "p.id = $1", valores: [filtro.pessoaId] };
      const r = await c.query<{
        id: string;
        nome: string;
        email: string;
        perfil: string;
        area: string | null;
        situacao: string;
      }>(
        `select p.id, p.nome, p.email, v.perfil, v.area, v.situacao
           from vinculos v join pessoas p on p.id = v.pessoa_id
          where v.empresa_id = empresa_ativa() and ${condicao.sql}
          order by p.nome`,
        condicao.valores,
      );
      return r.rows;
    });
    return linhas.map((l) => ({ ...l, email: verSensiveis ? l.email : null }));
  });

  // O que a própria pessoa pode, para a tela mostrar só o que vale para ela.
  app.get(
    "/empresa/minhas-permissoes",
    { preHandler: verificador.exigir("pessoas", "ver") },
    async (pedido) => {
      const { permissoes } = acessoDo(pedido);
      return {
        perfil: permissoes.perfil,
        area: permissoes.area,
        modulos: Object.fromEntries(permissoes.modulos),
      };
    },
  );

  // Ajuste de permissão de uma pessoa (padrão: só o administrador tem "permissoes.editar").
  app.put(
    "/empresa/permissoes",
    { preHandler: verificador.exigir("permissoes", "editar") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const r = conferirPedidoDeAjuste(pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      const { vinculoId, modulo, acao, alcance } = r.valor;
      const declaracao = verificador.catalogo.get(modulo);
      if (!declaracao)
        return resposta.code(400).send({ code: "MODULO_DESCONHECIDO", message: "Módulo desconhecido." });
      const acaoValida =
        acao === "ver_sensiveis"
          ? declaracao.temDadosSensiveis
          : (declaracao.acoes as string[]).includes(acao);
      if (!acaoValida)
        return resposta.code(400).send({ code: "ACAO_INVALIDA", message: "Esse módulo não tem essa ação." });

      const resultado = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
        const alvo = await c.query<{ perfil: string }>(
          "select perfil from vinculos where id = $1 and empresa_id = empresa_ativa()",
          [vinculoId],
        );
        if (!alvo.rows[0]) return "nao_encontrado" as const;
        if (alvo.rows[0].perfil === "administrador") return "administrador" as const;
        await c.query(
          `insert into ajustes_de_permissao (empresa_id, vinculo_id, modulo, acao, alcance, feito_por)
           values (empresa_ativa(), $1, $2, $3, $4, $5)
           on conflict (vinculo_id, modulo, acao)
           do update set alcance = excluded.alcance, feito_por = excluded.feito_por, feito_em = now()`,
          [vinculoId, modulo, acao, alcance, sessao.pessoa.id],
        );
        return "ok" as const;
      });
      if (resultado === "nao_encontrado") {
        return resposta
          .code(404)
          .send({ code: "VINCULO_NAO_ENCONTRADO", message: "Pessoa não encontrada nesta empresa." });
      }
      if (resultado === "administrador") {
        return resposta.code(400).send({
          code: "ADMINISTRADOR_SEM_AJUSTE",
          message: "O administrador já pode tudo na empresa; não há o que ajustar.",
        });
      }
      pedido.log.info(
        { evento: "permissao.alterou", vinculoId, modulo, acao, alcance },
        "Permissão ajustada",
      );
      await auditar(
        poolApp,
        {
          empresaId: sessao.empresaId,
          ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acao: "permissao.alterou",
          alvo: { tipo: "vinculo", id: vinculoId },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: { modulo, acao, alcance },
        },
        pedido.log,
      );
      return { ok: true };
    },
  );
}

/** Filtros da consulta da auditoria, todos opcionais. */
interface FiltrosDaAuditoria {
  pessoa?: string;
  acao?: string;
  desde?: string;
  ate?: string;
  limite?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registrarRotaDaAuditoria(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  // Consulta simples para o administrador (M1-09): os eventos da empresa ativa, dos mais novos para os mais
  // antigos, com filtro por pessoa, ação e período. O banco só mostra os eventos da própria empresa.
  app.get(
    "/empresa/auditoria",
    { preHandler: verificador.exigir("auditoria", "ver") },
    async (pedido, resposta) => {
      const { sessao } = acessoDo(pedido);
      const f = pedido.query as FiltrosDaAuditoria;
      const condicoes: string[] = ["empresa_id = empresa_ativa()"];
      const valores: unknown[] = [];
      if (f.pessoa) {
        if (!UUID.test(f.pessoa)) return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
        valores.push(f.pessoa);
        condicoes.push(`ator->>'pessoaId' = $${valores.length}`);
      }
      if (f.acao) {
        if (!/^[a-z_.]{2,80}$/.test(f.acao)) return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
        valores.push(f.acao.includes(".") ? f.acao : `${f.acao}.%`);
        condicoes.push(f.acao.includes(".") ? `acao = $${valores.length}` : `acao like $${valores.length}`);
      }
      for (const [campo, operador] of [
        ["desde", ">="],
        ["ate", "<="],
      ] as const) {
        const valor = f[campo];
        if (!valor) continue;
        if (Number.isNaN(Date.parse(valor))) return resposta.code(400).send({ code: "PEDIDO_INVALIDO" });
        valores.push(valor);
        condicoes.push(`ocorrido_em ${operador} $${valores.length}`);
      }
      const limite = Math.min(Math.max(Number(f.limite ?? 100) || 100, 1), 500);
      valores.push(limite);
      return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
        const r = await c.query(
          `select sequencia, ator, acao, alvo, origem, ocorrido_em, rastreio, detalhes
           from auditoria.eventos where ${condicoes.join(" and ")}
          order by sequencia desc limit $${valores.length}`,
          valores,
        );
        return r.rows;
      });
    },
  );
}

export { permissoesNaEmpresa };
