/**
 * Contas de IA da empresa (M4-01): as chaves de provedores de IA (Anthropic, OpenAI e compatíveis) que os
 * agentes internos usam, guardadas no cofre interno. Ver docs/decisoes/0021.
 *
 * A chave entra uma vez (ao conectar ou trocar) e nunca mais sai: nem pela tela, nem pela API, nem para o
 * administrador, nem para os agentes. O contrato só mostra os 4 últimos caracteres, para reconhecer a conta.
 * Valores de dinheiro são em centavos de dólar (US$), inteiros, como os provedores cobram.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/**
 * Provedores do M4 (decisão 2 da spec). anthropic: a API da Anthropic. compativel_openai: qualquer serviço que
 * fale o formato da OpenAI (OpenAI, OpenRouter, DeepSeek, Groq, Ollama e parecidos), pelo endereço e a chave.
 * Google, xAI e outros com API própria entram depois, cada um com o seu adaptador.
 */
export const PROVEDORES_DE_IA = ["anthropic", "compativel_openai"] as const;
export const ProvedorDeIa = Type.Enum(PROVEDORES_DE_IA, {
  description: "anthropic ou compativel_openai (OpenAI, OpenRouter, DeepSeek, Groq, Ollama e parecidos).",
});
export type ProvedorDeIa = Static<typeof ProvedorDeIa>;

/** ativa: o último teste passou. com_erro: o último teste ou a última chamada falhou (chave errada, sem crédito). */
export const SITUACOES_DA_CONTA_DE_IA = ["ativa", "com_erro"] as const;
export const SituacaoDaContaDeIa = Type.Enum(SITUACOES_DA_CONTA_DE_IA);
export type SituacaoDaContaDeIa = Static<typeof SituacaoDaContaDeIa>;

/**
 * Endereço da API de um provedor compatível com OpenAI (ex.: https://openrouter.ai/api/v1). Sempre https, menos
 * para um Ollama na própria máquina (http://localhost ou 127.0.0.1), útil na edição instalável e nos testes.
 */
export const EnderecoDoProvedor = Type.String({
  maxLength: 300,
  pattern:
    "^(https://[a-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?|http://(localhost|127\\.0\\.0\\.1)(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?)$",
  description: "Endereço da API (https; http só para localhost).",
});

/** A chave como a pessoa cola ao conectar ou trocar. Só entra, nunca sai. */
export const ChaveDoProvedor = Type.String({
  minLength: 8,
  maxLength: 400,
  pattern: "^[\\x21-\\x7e]+$",
  description: "Chave do provedor. Só entra: nunca é devolvida pela API.",
  writeOnly: true,
});

/** Centavos de dólar por mês. Sem teto: null. */
export const TetoMensal = Type.Integer({
  minimum: 0,
  maximum: 10_000_000,
  description: "Teto de gasto por mês, em centavos de dólar (US$ 20 = 2000).",
});

/** Nome do modelo como o provedor chama (ex.: claude-sonnet-5-5, gpt-5, deepseek/deepseek-chat). */
export const NomeDoModelo = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@-]*$",
  description: "Nome do modelo no provedor.",
});

const NomeDaConta = Texto(80, "Nome da conta como aparece nas telas (ex.: Anthropic da Nolask).");

export const ContaDeIa = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: NomeDaConta,
    provedor: ProvedorDeIa,
    /** Só para compativel_openai. A Anthropic usa o endereço oficial, fixo no código. */
    endereco: OuNulo(EnderecoDoProvedor),
    /** Os 4 últimos caracteres da chave, para reconhecer qual é. */
    finalDaChave: Type.String({ pattern: "^[\\x21-\\x7e]{4}$" }),
    situacao: SituacaoDaContaDeIa,
    /** O que deu errado no último teste ou chamada, em texto curto e sem a chave. */
    ultimoErro: OuNulo(Texto(300, "O que deu errado, sem a chave.")),
    tetoMensal: OuNulo(TetoMensal),
    testadaEm: OuNulo(DataHora),
    criadaPor: Id,
    criadaEm: DataHora,
    atualizadaEm: DataHora,
  },
  { additionalProperties: false, description: "Conta de IA da empresa (sem a chave)." },
);
export type ContaDeIa = Static<typeof ContaDeIa>;

export const regrasDaContaDeIa: Regra<ContaDeIa>[] = [
  (c): Problema[] => {
    if (c.provedor === "compativel_openai" && c.endereco === null) {
      return [{ caminho: "/endereco", mensagem: "provedor compatível com OpenAI precisa do endereço" }];
    }
    if (c.provedor === "anthropic" && c.endereco !== null) {
      return [{ caminho: "/endereco", mensagem: "a Anthropic usa o endereço oficial" }];
    }
    return [];
  },
  (c): Problema[] =>
    c.situacao === "com_erro" && c.ultimoErro === null
      ? [{ caminho: "/ultimoErro", mensagem: "conta com erro diz qual foi" }]
      : [],
];

export function conferirContaDeIa(valor: unknown) {
  return conferir(ContaDeIa, valor, regrasDaContaDeIa);
}

/** Conectar uma conta (só quem tem "Contas de IA: criar", padrão o administrador). O núcleo testa antes de gravar. */
export const PedidoDeContaDeIa = Type.Object(
  {
    nome: NomeDaConta,
    provedor: ProvedorDeIa,
    endereco: Type.Optional(OuNulo(EnderecoDoProvedor)),
    chave: ChaveDoProvedor,
    tetoMensal: Type.Optional(OuNulo(TetoMensal)),
  },
  { additionalProperties: false },
);
export type PedidoDeContaDeIa = Static<typeof PedidoDeContaDeIa>;

/** Editar uma conta: nome, teto ou trocar a chave (a troca testa a chave nova antes de valer). */
export const PedidoDeEditarContaDeIa = Type.Object(
  {
    nome: Type.Optional(NomeDaConta),
    tetoMensal: Type.Optional(OuNulo(TetoMensal)),
    chave: Type.Optional(ChaveDoProvedor),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarContaDeIa = Static<typeof PedidoDeEditarContaDeIa>;

/**
 * Um modelo que o provedor oferece na conta. Ao conectar (e ao testar de novo), o núcleo lista os modelos; os
 * novos chegam desligados e só o administrador libera. Só modelo liberado pode ser escolhido para um agente.
 */
export const ModeloDaConta = Type.Object(
  {
    contaId: Id,
    modelo: NomeDoModelo,
    liberado: Type.Boolean(),
    /** Saiu da lista do provedor no último teste: continua aparecendo, mas não pode ser escolhido. */
    sumiu: Type.Boolean(),
    descobertoEm: DataHora,
  },
  { additionalProperties: false },
);
export type ModeloDaConta = Static<typeof ModeloDaConta>;

/** Liberar ou desligar modelos de uma conta, vários de uma vez. */
export const PedidoDeLiberarModelos = Type.Object(
  {
    modelos: Type.Array(
      Type.Object({ modelo: NomeDoModelo, liberado: Type.Boolean() }, { additionalProperties: false }),
      { minItems: 1, maxItems: 200 },
    ),
  },
  { additionalProperties: false },
);
export type PedidoDeLiberarModelos = Static<typeof PedidoDeLiberarModelos>;

/** Um modelo de uma conta, como o agente usa. */
export const ModeloEscolhido = Type.Object(
  { contaId: Id, modelo: NomeDoModelo },
  { additionalProperties: false },
);
export type ModeloEscolhido = Static<typeof ModeloEscolhido>;

/**
 * Modelo de um agente interno: o principal e o reserva (opcional). Se o principal falha (provedor fora, chave
 * com erro) ou a conta chega no teto, a execução passa para o reserva sem parar e isso fica registrado.
 */
export const ModelosDoAgente = Type.Object(
  { principal: ModeloEscolhido, reserva: OuNulo(ModeloEscolhido) },
  { additionalProperties: false },
);
export type ModelosDoAgente = Static<typeof ModelosDoAgente>;

export const regrasDosModelosDoAgente: Regra<ModelosDoAgente>[] = [
  (m): Problema[] =>
    m.reserva !== null && m.reserva.contaId === m.principal.contaId && m.reserva.modelo === m.principal.modelo
      ? [{ caminho: "/reserva", mensagem: "o reserva precisa ser outro modelo ou outra conta" }]
      : [],
];

export function conferirModelosDoAgente(valor: unknown) {
  return conferir(ModelosDoAgente, valor, regrasDosModelosDoAgente);
}

/** Resultado de testar uma conta: deu certo e quais modelos o provedor listou, ou o erro em texto curto. */
export const TesteDaContaDeIa = Type.Union([
  Type.Object(
    { ok: Type.Literal(true), modelos: Type.Array(NomeDoModelo, { maxItems: 1000 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { ok: Type.Literal(false), erro: Texto(300, "O que deu errado, sem a chave.") },
    { additionalProperties: false },
  ),
]);
export type TesteDaContaDeIa = Static<typeof TesteDaContaDeIa>;

/** Ações de auditoria das contas de IA. Nunca levam a chave nos detalhes (só o final de 4 caracteres). */
export const ACOES_CONTAS_DE_IA = [
  "ia.conectou",
  "ia.testou",
  "ia.trocou_chave",
  "ia.editou",
  "ia.liberou_modelo",
  "ia.apagou",
  "agente.escolheu_modelo",
] as const;
