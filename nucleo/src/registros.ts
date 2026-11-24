/**
 * Filtro dos registros (M6-02, decisão 2 da spec do M6): os registros saem do servidor para o destino central, então
 * não podem levar dado pessoal nem sensível. O código já não registra textos; este filtro apaga o que escapar:
 * campos de texto livre e segredos pelo nome, e e-mails, chaves e tokens dentro de qualquer texto.
 */

const RETIRADO = "[retirado]";

/** Campos que nunca vão para os registros (texto de tarefa, mensagem, e-mail, segredos), em qualquer nível. */
const CAMPOS_RETIRADOS = new Set([
  "texto",
  "titulo",
  "descricao",
  "conteudo",
  "corpo",
  "body",
  "legenda",
  "caption",
  "pedido",
  "resultado",
  "nome",
  "email",
  "telefone",
  "documento",
  "senha",
  "password",
  "token",
  "chave",
  "segredo",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
  "credencial",
]);

/** Padrões apagados dentro de qualquer texto. */
const PADROES: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]"],
  // O token do bot do Telegram vai no caminho das chamadas (api.telegram.org/bot<token>/...).
  [/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot[token]"],
  [/\bmago_ag_[0-9a-z]{10}_[A-Za-z0-9_-]+/g, "[chave]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[chave]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[credencial]"],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token]"],
];

/** Apaga e-mails, chaves e tokens de um texto. */
export function limparTexto(texto: string): string {
  let t = texto;
  for (const [padrao, troca] of PADROES) t = t.replace(padrao, troca);
  return t;
}

/** O endereço sem os valores da consulta (a busca e os filtros podem ter texto de tarefa). */
export function enderecoSemValores(url: string | undefined): string {
  if (typeof url !== "string") return "";
  const i = url.indexOf("?");
  if (i < 0) return limparTexto(url);
  const chaves = url
    .slice(i + 1)
    .split("&")
    .filter(Boolean)
    .map((p) => `${p.split("=")[0]}=…`);
  return `${limparTexto(url.slice(0, i))}?${chaves.join("&")}`;
}

/** Limpa um objeto de registro, em qualquer nível (sem mudar o original). */
export function limparRegistro(valor: unknown, profundidade = 0): unknown {
  if (typeof valor === "string") return limparTexto(valor);
  if (valor === null || typeof valor !== "object") return valor;
  if (profundidade > 8) return RETIRADO;
  if (valor instanceof Error) {
    return {
      tipo: valor.name,
      mensagem: limparTexto(valor.message),
      ...(valor.stack ? { pilha: limparTexto(valor.stack) } : {}),
      ...("code" in valor && typeof valor.code === "string" ? { codigo: valor.code } : {}),
    };
  }
  if (Array.isArray(valor)) return valor.map((x) => limparRegistro(x, profundidade + 1));
  const prototipo = Object.getPrototypeOf(valor);
  if (prototipo !== Object.prototype && prototipo !== null) {
    // O pedido e a resposta do Fastify passam como estão: os serializadores do servidor cuidam deles.
    if ("raw" in valor) return valor;
    if (valor instanceof Date) return valor.toISOString();
    if (Buffer.isBuffer(valor) || ArrayBuffer.isView(valor)) return "[dados]";
    if (valor instanceof Map) return limparRegistro(Object.fromEntries(valor), profundidade + 1);
    if (valor instanceof Set) return limparRegistro([...valor], profundidade + 1);
    // URL e outros objetos com toJSON viram o que mostrariam; os demais, só os próprios campos.
    const comoJson = valor as { toJSON?: () => unknown };
    if (typeof comoJson.toJSON === "function") return limparRegistro(comoJson.toJSON(), profundidade + 1);
    return limparRegistro({ ...valor }, profundidade + 1);
  }
  const limpo: Record<string, unknown> = {};
  for (const [campo, x] of Object.entries(valor)) {
    limpo[campo] = CAMPOS_RETIRADOS.has(campo.toLowerCase()) ? RETIRADO : limparRegistro(x, profundidade + 1);
  }
  return limpo;
}
