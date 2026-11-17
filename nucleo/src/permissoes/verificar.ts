/**
 * Verificação central das permissões (M1-06): toda rota de dados pergunta aqui "esta pessoa pode fazer esta
 * ação neste módulo?". A resposta traz o alcance, que vira o filtro da consulta: quem só pode ver os próprios
 * itens nem recebe os dos outros. O isolamento entre empresas continua no banco, por baixo disto.
 */
import type {
  AcaoNoModulo,
  Alcance,
  DeclaracaoDeModulo,
  Perfil,
  PermissaoNoModulo,
} from "@mago-os/contratos";
import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Login } from "../acesso/login.ts";
import { type SessaoDoPedido, sessaoDoPedido } from "../acesso/rotas.ts";
import { comPessoa } from "../empresa.ts";
import { type Ajuste, type Filtro, filtroDoAlcance, permissaoNoModulo } from "./calcular.ts";

export interface PermissoesNaEmpresa {
  vinculoId: string;
  perfil: Perfil;
  area: string | null;
  modulos: Map<string, PermissaoNoModulo>;
}

/** Carrega o vínculo da pessoa na empresa ativa e os ajustes dele, e calcula as permissões de cada módulo. */
export async function permissoesNaEmpresa(
  poolApp: pg.Pool,
  pessoaId: string,
  empresaId: string,
  catalogo: Map<string, DeclaracaoDeModulo>,
): Promise<PermissoesNaEmpresa | null> {
  return comPessoa(poolApp, pessoaId, empresaId, async (c) => {
    // empresa_ativa() já confere o vínculo ativo: sem ele, nenhuma linha volta.
    const v = await c.query<{ id: string; perfil: Perfil; area: string | null }>(
      `select id, perfil, area from vinculos
        where pessoa_id = $1 and empresa_id = empresa_ativa() and situacao = 'ativo'`,
      [pessoaId],
    );
    const vinculo = v.rows[0];
    if (!vinculo) return null;
    const a = await c.query<Ajuste>(
      "select modulo, acao, alcance from ajustes_de_permissao where vinculo_id = $1",
      [vinculo.id],
    );
    const modulos = new Map<string, PermissaoNoModulo>();
    for (const modulo of catalogo.values())
      modulos.set(modulo.id, permissaoNoModulo(vinculo, modulo, a.rows));
    return { vinculoId: vinculo.id, perfil: vinculo.perfil, area: vinculo.area, modulos };
  });
}

/** O que a rota recebe depois de passar pela verificação. */
export interface AcessoDoPedido {
  sessao: SessaoDoPedido & { empresaId: string };
  permissoes: PermissoesNaEmpresa;
  alcance: Alcance;
  filtro: Filtro;
  verSensiveis: boolean;
}

export interface Verificador {
  /** preHandler do Fastify: só deixa passar quem pode fazer a ação no módulo. */
  exigir(
    modulo: string,
    acao: AcaoNoModulo,
  ): (pedido: FastifyRequest, resposta: FastifyReply) => Promise<unknown>;
  catalogo: Map<string, DeclaracaoDeModulo>;
}

export function acessoDo(pedido: FastifyRequest): AcessoDoPedido {
  const acesso = (pedido as FastifyRequest & { acesso?: AcessoDoPedido }).acesso;
  if (!acesso) throw new Error("Rota sem a verificação de permissão (use verificador.exigir)");
  return acesso;
}

export function criarVerificador(
  login: Login,
  poolAcesso: pg.Pool,
  poolApp: pg.Pool,
  catalogo: Map<string, DeclaracaoDeModulo>,
): Verificador {
  return {
    catalogo,
    exigir(modulo, acao) {
      if (!catalogo.has(modulo)) throw new Error(`Módulo desconhecido na rota: ${modulo}`);
      return async (pedido, resposta) => {
        const sessao = await sessaoDoPedido(login, poolAcesso, pedido);
        if (!sessao)
          return resposta.code(401).send({ code: "SEM_SESSAO", message: "Entre no Mago OS para continuar." });
        if (!sessao.estado.completa) {
          return resposta.code(403).send({
            code: sessao.estado.falta === "ativar" ? "DOIS_FATORES_ATIVAR" : "DOIS_FATORES_CONFIRMAR",
            message: "Confirme a autenticação em 2 fatores para continuar.",
          });
        }
        if (!sessao.empresaId) {
          return resposta
            .code(409)
            .send({ code: "EMPRESA_NAO_ESCOLHIDA", message: "Escolha uma empresa para continuar." });
        }
        const permissoes = await permissoesNaEmpresa(poolApp, sessao.pessoa.id, sessao.empresaId, catalogo);
        const permissao = permissoes?.modulos.get(modulo);
        const alcance = permissao?.acoes[acao] ?? "nada";
        const filtro = permissoes ? filtroDoAlcance(alcance, sessao.pessoa.id, permissoes.area) : null;
        if (!permissoes || !permissao || !filtro) {
          pedido.log.warn({ evento: "permissao.negou", modulo, acao }, "Ação sem permissão");
          return resposta
            .code(403)
            .send({ code: "SEM_PERMISSAO", message: "Você não tem permissão para isso." });
        }
        (pedido as FastifyRequest & { acesso?: AcessoDoPedido }).acesso = {
          sessao: { ...sessao, empresaId: sessao.empresaId },
          permissoes,
          alcance,
          filtro,
          verSensiveis: permissao.verSensiveis,
        };
      };
    },
  };
}
