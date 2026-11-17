/**
 * Pessoa: quem faz login. Um e-mail é uma pessoa só no sistema inteiro; a mesma pessoa pode estar em
 * várias empresas (ver Vinculo), cada uma com as próprias permissões.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Email, Id, Texto } from "../comum.ts";

export const SITUACOES_PESSOA = ["ativa", "bloqueada"] as const;

/** ativa: pode entrar. bloqueada: não entra em nenhuma empresa, e as sessões dela são encerradas. */
export const SituacaoPessoa = Type.Enum(SITUACOES_PESSOA, {
  description: "ativa: pode entrar. bloqueada: não entra em nenhuma empresa.",
});

/** Idioma no formato BCP 47 curto (ex.: pt-BR, en, es-ES). */
export const Idioma = Type.String({
  pattern: "^[a-z]{2,3}(-[A-Z]{2})?$",
  description: "Idioma (ex.: pt-BR).",
});

/** Fuso horário IANA (ex.: America/Sao_Paulo, Europe/Lisbon, UTC). */
export const FusoHorario = Type.String({
  pattern: "^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$",
  maxLength: 64,
  description: "Fuso horário IANA (ex.: America/Sao_Paulo).",
});

export const Pessoa = Type.Object(
  {
    id: Id,
    nome: Texto(200, "Nome como aparece no sistema."),
    email: Email,
    foto: Type.Optional(Type.String({ format: "uri", pattern: "^https://", maxLength: 2048 })),
    idioma: Idioma,
    fusoHorario: FusoHorario,
    situacao: SituacaoPessoa,
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Pessoa que faz login no Mago OS." },
);
export type Pessoa = Static<typeof Pessoa>;

export function conferirPessoa(valor: unknown) {
  return conferir(Pessoa, valor);
}
