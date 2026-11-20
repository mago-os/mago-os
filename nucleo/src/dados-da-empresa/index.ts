/**
 * Dados da empresa (M3-11): todos da empresa veem; quem tem "empresa.editar" (padrão: o administrador) muda. O CPF
 * aparece mascarado para quem não vê dados sensíveis. Mudar o documento pede o segundo fator recente, como as outras
 * ações perigosas. Cada mudança vira o evento empresa.alterou, com os campos que mudaram (documento, nome legal e
 * telefone, só "mudou").
 */
import {
  conferirPedidoDeDadosDaEmpresa,
  type DadosDaEmpresa,
  mascararDocumento,
  type PedidoDeDadosDaEmpresa,
} from "@mago-os/contratos";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";

interface Linha {
  nome: string;
  tipo: "pf" | "pj" | null;
  documento: string | null;
  nome_legal: string | null;
  fuso_horario: string;
  idioma: string;
  telefone: string | null;
}

const COLUNAS = "nome, tipo, documento, nome_legal, fuso_horario, idioma, telefone";

/** O fuso existe de verdade (o contrato só confere o formato). */
export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

function paraDados(l: Linha, verSensiveis: boolean, podeEditar: boolean): DadosDaEmpresa {
  return {
    nome: l.nome,
    tipo: l.tipo,
    // CPF é dado pessoal: mascarado para quem não vê dados sensíveis (o CNPJ é público).
    documento: l.documento && !verSensiveis && l.tipo === "pf" ? mascararDocumento(l.documento) : l.documento,
    nomeLegal: l.nome_legal,
    fusoHorario: l.fuso_horario,
    idioma: l.idioma as DadosDaEmpresa["idioma"],
    telefone: l.telefone,
    podeEditar,
  };
}

/** Os campos que mudaram (nomes do contrato), para a auditoria. */
export function camposQueMudaram(
  antes: Linha,
  depois: PedidoDeDadosDaEmpresa,
): (keyof PedidoDeDadosDaEmpresa)[] {
  const pares: [keyof PedidoDeDadosDaEmpresa, unknown, unknown][] = [
    ["nome", antes.nome, depois.nome.trim()],
    ["tipo", antes.tipo, depois.tipo],
    ["documento", antes.documento, depois.documento],
    ["nomeLegal", antes.nome_legal, depois.nomeLegal?.trim() ?? null],
    ["fusoHorario", antes.fuso_horario, depois.fusoHorario],
    ["idioma", antes.idioma, depois.idioma],
    ["telefone", antes.telefone, depois.telefone],
  ];
  return pares.filter(([, a, d]) => a !== d).map(([k]) => k);
}

export function registrarRotasDosDadosDaEmpresa(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  app.get("/empresa/dados", { preHandler: verificador.exigir("empresa", "ver") }, async (pedido) => {
    const { sessao, permissoes, verSensiveis } = acessoDo(pedido);
    const podeEditar = (permissoes.modulos.get("empresa")?.acoes.editar ?? "nada") !== "nada";
    const linha = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
      const r = await c.query<Linha>(`select ${COLUNAS} from empresas where id = empresa_ativa()`);
      return r.rows[0] as Linha;
    });
    return paraDados(linha, verSensiveis, podeEditar);
  });

  app.post(
    "/empresa/dados",
    { preHandler: verificador.exigir("empresa", "editar") },
    async (pedido, resposta) => {
      // Quem vê o CPF mascarado e salva sem mexer nele manda o mascarado de volta: vale o que já estava.
      const corpo = { ...((pedido.body ?? {}) as Record<string, unknown>) };
      if (typeof corpo.documento === "string" && corpo.documento.includes("*")) {
        const { sessao } = acessoDo(pedido);
        const atual = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
          const l = await c.query<{ documento: string | null }>(
            "select documento from empresas where id = empresa_ativa()",
          );
          return l.rows[0]?.documento ?? null;
        });
        if (!atual || corpo.documento !== mascararDocumento(atual)) {
          return resposta
            .code(400)
            .send({ code: "DOCUMENTO_INVALIDO", message: "Informe o documento completo." });
        }
        corpo.documento = atual;
      }
      const r = conferirPedidoDeDadosDaEmpresa(corpo);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      if (!fusoValido(r.valor.fusoHorario)) {
        return resposta
          .code(400)
          .send({ code: "FUSO_INVALIDO", message: "Escolha um fuso horário da lista." });
      }
      const { sessao, verSensiveis } = acessoDo(pedido);
      const feito = await comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, async (c) => {
        const antes = (
          await c.query<Linha>(`select ${COLUNAS} from empresas where id = empresa_ativa() for update`)
        ).rows[0] as Linha;
        const mudou = camposQueMudaram(antes, r.valor);
        if (mudou.length === 0) return { mudou, linha: antes };
        // Trocar o documento é ação perigosa: pede o segundo fator recente.
        if (
          (mudou.includes("documento") || mudou.includes("tipo")) &&
          !podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo)
        )
          return null;
        const d = await c.query<Linha>(
          `update empresas set nome = $1, tipo = $2, documento = $3, nome_legal = $4, fuso_horario = $5, idioma = $6,
                telefone = $7, atualizada_em = now()
          where id = empresa_ativa() returning ${COLUNAS}`,
          [
            r.valor.nome.trim(),
            r.valor.tipo,
            r.valor.documento,
            r.valor.nomeLegal?.trim() ?? null,
            r.valor.fusoHorario,
            r.valor.idioma,
            r.valor.telefone,
          ],
        );
        return { mudou, linha: d.rows[0] as Linha };
      });
      if (!feito) {
        return resposta.code(403).send({
          code: "CONFIRMACAO_NECESSARIA",
          message: "Por segurança, confirme com o código do app ou com a passkey antes de mudar o documento.",
        });
      }
      if (feito.mudou.length > 0) {
        // Os valores novos só dos campos sem dado pessoal; do documento, do nome legal e do telefone fica só que
        // mudaram (para conta de pessoa física, são dados da pessoa).
        const SEM_DADO_PESSOAL = new Set(["nome", "tipo", "fusoHorario", "idioma"]);
        const novos = Object.fromEntries(
          feito.mudou
            .filter((k) => SEM_DADO_PESSOAL.has(k))
            .map((k) => [k, (r.valor as Record<string, unknown>)[k] ?? null]),
        );
        await auditar(
          poolApp,
          {
            empresaId: sessao.empresaId,
            ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
            acao: "empresa.alterou",
            alvo: { tipo: "empresa", id: sessao.empresaId },
            origem: origemDoPedido(pedido),
            rastreio: pedido.id,
            detalhes: { campos: feito.mudou, ...novos },
          },
          pedido.log,
        );
      }
      return paraDados(feito.linha, verSensiveis, true);
    },
  );
}
