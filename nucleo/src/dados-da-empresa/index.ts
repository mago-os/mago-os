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
      const { sessao, verSensiveis } = acessoDo(pedido);
      type Resultado =
        | { erro: number; code: string; message: string }
        | { mudou: (keyof PedidoDeDadosDaEmpresa)[]; linha: Linha; valor: PedidoDeDadosDaEmpresa };
      let feito: Resultado;
      try {
        feito = await comPessoa(
          poolApp,
          sessao.pessoa.id,
          sessao.empresaId,
          async (c): Promise<Resultado> => {
            // Tudo numa transação só, com a linha travada: duas pessoas salvando ao mesmo tempo não se atropelam.
            const antes = (
              await c.query<Linha>(`select ${COLUNAS} from empresas where id = empresa_ativa() for update`)
            ).rows[0] as Linha;
            // Quem vê o CPF mascarado e salva sem mexer nele manda o mascarado de volta: vale o que já estava.
            const corpo = { ...((pedido.body ?? {}) as Record<string, unknown>) };
            if (typeof corpo.documento === "string" && corpo.documento.includes("*")) {
              if (!antes.documento || corpo.documento !== mascararDocumento(antes.documento))
                return { erro: 400, code: "DOCUMENTO_INVALIDO", message: "Informe o documento completo." };
              corpo.documento = antes.documento;
            }
            const r = conferirPedidoDeDadosDaEmpresa(corpo);
            if (!r.ok) {
              const p = r.problemas[0];
              return {
                erro: 400,
                code: "PEDIDO_INVALIDO",
                message: p ? `Confira: ${p.mensagem}.` : "Confira os campos e tente de novo.",
              };
            }
            if (!fusoValido(r.valor.fusoHorario))
              return { erro: 400, code: "FUSO_INVALIDO", message: "Escolha um fuso horário da lista." };
            const mudou = camposQueMudaram(antes, r.valor);
            if (mudou.length === 0) return { mudou, linha: antes, valor: r.valor };
            // Trocar o documento é ação perigosa: pede o segundo fator recente.
            if (
              (mudou.includes("documento") || mudou.includes("tipo")) &&
              !podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo)
            )
              return {
                erro: 403,
                code: "CONFIRMACAO_NECESSARIA",
                message:
                  "Por segurança, confirme com o código do app ou com a passkey antes de mudar o documento.",
              };
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
            return { mudou, linha: d.rows[0] as Linha, valor: r.valor };
          },
        );
      } catch (erro) {
        if ((erro as { code?: string }).code === "23505") {
          return resposta.code(409).send({
            code: "DOCUMENTO_JA_USADO",
            message: "Esse documento já está em outra conta do Mago OS.",
          });
        }
        throw erro;
      }
      if ("erro" in feito)
        return resposta.code(feito.erro).send({ code: feito.code, message: feito.message });
      if (feito.mudou.length > 0) {
        // Os valores novos só dos campos sem dado pessoal; do documento, do nome legal e do telefone fica só que
        // mudaram (para conta de pessoa física, são dados da pessoa).
        // Na conta de pessoa física, o nome de exibição costuma ser o da própria pessoa: também fica só "mudou".
        const SEM_DADO_PESSOAL = new Set(
          feito.valor.tipo === "pf"
            ? ["tipo", "fusoHorario", "idioma"]
            : ["nome", "tipo", "fusoHorario", "idioma"],
        );
        const novos = Object.fromEntries(
          feito.mudou
            .filter((k) => SEM_DADO_PESSOAL.has(k))
            .map((k) => [k, (feito.valor as Record<string, unknown>)[k] ?? null]),
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
