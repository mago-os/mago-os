/** Empresa: cada empresa só enxerga os próprios dados (Row Level Security, docs/banco/decisoes.md). */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Email, Id, OuNulo, type Problema, Texto } from "../comum.ts";
import { Documento, documentoValido, TipoDeConta } from "./documento.ts";
import { FusoHorario, Idioma } from "./pessoa.ts";

export const SITUACOES_EMPRESA = ["ativa", "suspensa"] as const;

/** ativa: funciona normalmente. suspensa: ninguém da empresa entra (planos e cobrança ficam para a Fase 2). */
export const SituacaoEmpresa = Type.Enum(SITUACOES_EMPRESA, {
  description: "ativa: funciona normalmente. suspensa: ninguém da empresa entra.",
});

/** Telefone de contato, com DDI opcional (ex.: +55 11 91234-5678). */
function Telefone() {
  return Type.String({ pattern: "^\\+?[0-9 ()-]{8,25}$", description: "Telefone de contato." });
}

export const Empresa = Type.Object(
  {
    id: Id,
    nome: Texto(200, "Nome da empresa como aparece no sistema."),
    tipo: OuNulo(TipoDeConta),
    documento: OuNulo(Documento),
    nomeLegal: OuNulo(Texto(200, "Razão social (CNPJ) ou nome completo (CPF).")),
    fusoHorario: FusoHorario,
    idioma: Idioma,
    telefone: OuNulo(Telefone()),
    situacao: SituacaoEmpresa,
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  {
    additionalProperties: false,
    description:
      "Conta que usa o Mago OS: uma empresa (CNPJ) ou uma pessoa física (CPF). As contas criadas antes da M1-11 podem estar sem documento.",
  },
);
export type Empresa = Static<typeof Empresa>;

export function conferirEmpresa(valor: unknown) {
  return conferir(Empresa, valor);
}

/** O que o Dono informa para convidar uma conta nova (M1-11): o nome e o e-mail de quem vai criá-la. */
export const PedidoDeConviteDeEmpresa = Type.Object(
  {
    nome: Texto(200, "Nome do responsável pela conta nova."),
    email: Email,
  },
  { additionalProperties: false },
);
export type PedidoDeConviteDeEmpresa = Static<typeof PedidoDeConviteDeEmpresa>;

export function conferirPedidoDeConviteDeEmpresa(valor: unknown) {
  return conferir(PedidoDeConviteDeEmpresa, valor);
}

/**
 * O que o responsável preenche ao abrir o link. Obrigatórios só o nome de exibição e o fuso (ajuste do Sandro em
 * 17/11/2026): tipo, documento, nome legal e telefone podem ficar para depois. Tipo e documento andam juntos, e o
 * documento entra normalizado (normalizarDocumento) e conferido pelos dígitos.
 */
export const PedidoDeNovaEmpresa = Type.Object(
  {
    tipo: OuNulo(TipoDeConta),
    documento: OuNulo(Documento),
    nomeLegal: OuNulo(Texto(200, "Razão social (CNPJ) ou nome completo (CPF).")),
    nome: Texto(200, "Nome de exibição no Mago OS."),
    fusoHorario: FusoHorario,
    idioma: Idioma,
    telefone: OuNulo(Telefone()),
  },
  { additionalProperties: false },
);
export type PedidoDeNovaEmpresa = Static<typeof PedidoDeNovaEmpresa>;

export function conferirPedidoDeNovaEmpresa(valor: unknown) {
  return conferir(PedidoDeNovaEmpresa, valor, [
    (p): Problema[] => {
      if (p.documento === null)
        return p.tipo === null
          ? []
          : [{ caminho: "/documento", mensagem: "informe o documento do tipo escolhido" }];
      if (p.tipo === null) return [{ caminho: "/tipo", mensagem: "diga se o documento é CNPJ ou CPF" }];
      if (p.tipo === "pf" && p.documento.length !== 11)
        return [{ caminho: "/documento", mensagem: "pessoa física usa CPF (11 dígitos)" }];
      if (p.tipo === "pj" && p.documento.length !== 14)
        return [{ caminho: "/documento", mensagem: "empresa usa CNPJ (14 caracteres)" }];
      if (!documentoValido(p.tipo, p.documento))
        return [{ caminho: "/documento", mensagem: p.tipo === "pf" ? "CPF inválido" : "CNPJ inválido" }];
      return [];
    },
  ]);
}
