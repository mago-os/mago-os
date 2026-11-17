/**
 * CPF e CNPJ (M1-11): quem abre uma conta no Mago OS é uma empresa (CNPJ) ou uma pessoa física (CPF).
 * A conferência usa os dígitos verificadores. O CNPJ aceita também o formato com letras (Receita Federal, a partir
 * de julho de 2026): 12 caracteres de letras maiúsculas ou números e 2 dígitos verificadores.
 */
import { Type } from "typebox";

export const TIPOS_DE_CONTA = ["pj", "pf"] as const;
export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number];

/** pj: empresa, com CNPJ. pf: pessoa física, com CPF. */
export const TipoDeConta = Type.Enum(TIPOS_DE_CONTA, {
  description: "pj: empresa com CNPJ. pf: pessoa física com CPF.",
});

/** Documento guardado sem pontuação: 11 dígitos (CPF) ou 14 caracteres (CNPJ, com letras maiúsculas ou números). */
export const Documento = Type.String({
  pattern: "^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$",
  description: "CPF (11 dígitos) ou CNPJ (14 caracteres), sem pontuação.",
});

/** Tira pontos, traços, barras e espaços, e passa as letras para maiúsculas. */
export function normalizarDocumento(documento: string): string {
  return documento.replace(/[\s./-]/g, "").toUpperCase();
}

function repetido(valor: string): boolean {
  return /^(.)\1+$/.test(valor);
}

export function cpfValido(cpf: string): boolean {
  if (!/^[0-9]{11}$/.test(cpf) || repetido(cpf)) return false;
  const digitos = [...cpf].map(Number);
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += (digitos[i] as number) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== digitos[tamanho]) return false;
  }
  return true;
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || repetido(cnpj)) return false;
  // Cada caractere vale o código ASCII menos 48 (os números valem eles mesmos; A vale 17, B 18...).
  const valores = [...cnpj].map((c) => c.charCodeAt(0) - 48);
  for (const tamanho of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += (valores[i] as number) * (((tamanho - 1 - i) % 8) + 2);
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== valores[tamanho]) return false;
  }
  return true;
}

/** Confere o documento de acordo com o tipo da conta (já normalizado). */
export function documentoValido(tipo: TipoDeConta, documento: string): boolean {
  return tipo === "pf" ? cpfValido(documento) : cnpjValido(documento);
}

/** Documento com a pontuação de costume: 123.456.789-09 ou 12.345.678/0001-95. */
export function formatarDocumento(documento: string): string {
  if (documento.length === 11) return documento.replace(/^(.{3})(.{3})(.{3})(.{2})$/, "$1.$2.$3-$4");
  return documento.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * CPF é dado pessoal (LGPD): para quem não é administrador da conta nem Dono, aparece só o miolo (***.456.789-**).
 * O CNPJ é público e aparece inteiro.
 */
export function mascararDocumento(documento: string): string {
  if (documento.length !== 11) return formatarDocumento(documento);
  return `***.${documento.slice(3, 6)}.${documento.slice(6, 9)}-**`;
}
