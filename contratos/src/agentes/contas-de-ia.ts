/**
 * Contas de IA da empresa (M4-01): as chaves de provedores de IA (Anthropic, OpenAI e compatíveis) que os
 * agentes internos usam, guardadas no cofre interno. Ver docs/decisoes/0021.
 *
 * A chave entra uma vez (ao conectar ou trocar) e nunca mais sai: nem pela tela, nem pela API, nem para o
 * administrador, nem para os agentes. O contrato só mostra os 4 últimos caracteres, para reconhecer a conta.
 * Valores de dinheiro são em centavos de dólar (US$), inteiros, como os provedores cobram.
 *
 * M4-10 (decisão 0022): a conta pode ser por chave de API ou por plano de assinatura (Claude Pro ou Max, ChatGPT).
 * Cumprir a política de cada provedor é responsabilidade do administrador, que aceita os termos ao conectar.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/**
 * Provedores do M4 (decisão 2 da spec). anthropic: a API da Anthropic (chave de API ou plano Claude Pro e Max).
 * compativel_openai: qualquer serviço que fale o formato da OpenAI (OpenAI, OpenRouter, DeepSeek, Groq, Ollama e
 * parecidos), pelo endereço e a chave. chatgpt (M4-10): o plano do ChatGPT, pelo login do Codex, só assinatura.
 * Google, xAI e outros com API própria entram depois, cada um com o seu adaptador.
 */
export const PROVEDORES_DE_IA = ["anthropic", "compativel_openai", "chatgpt"] as const;
export const ProvedorDeIa = Type.Enum(PROVEDORES_DE_IA, {
  description:
    "anthropic, compativel_openai (OpenAI, OpenRouter, DeepSeek, Groq, Ollama e parecidos) ou chatgpt (só assinatura).",
});
export type ProvedorDeIa = Static<typeof ProvedorDeIa>;

/**
 * Como a conta entra no provedor (M4-10). chave_de_api: cobrada por uso, com custo e teto. assinatura: o login de um
 * plano (o token do `claude setup-token`, ou o arquivo de login do Codex para o ChatGPT), sem custo por uso.
 */
export const TIPOS_DE_CREDENCIAL = ["chave_de_api", "assinatura"] as const;
export const TipoDeCredencial = Type.Enum(TIPOS_DE_CREDENCIAL, {
  description:
    "chave_de_api (cobrada por uso) ou assinatura (o login de um plano, por conta e risco do administrador).",
});
export type TipoDeCredencial = Static<typeof TipoDeCredencial>;

/** Quais provedores aceitam cada tipo de credencial. */
export const CREDENCIAIS_DO_PROVEDOR: Record<ProvedorDeIa, readonly TipoDeCredencial[]> = {
  anthropic: ["chave_de_api", "assinatura"],
  compativel_openai: ["chave_de_api"],
  chatgpt: ["assinatura"],
};

/**
 * O aviso que o administrador aceita ao conectar uma assinatura. A versão vai para a auditoria com o aceite: se o
 * texto mudar, a versão sobe.
 */
export const AVISO_DA_ASSINATURA = {
  versao: 1,
  texto:
    "Usar um plano de assinatura fora dos apps do provedor pode ir contra os termos dele e levar ao bloqueio da conta. " +
    "Cada provedor tem uma regra diferente, e o Mago OS não decide por você. Ao conectar, você confirma que leu os " +
    "termos do provedor e assume a responsabilidade pelo uso.",
} as const;

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

/** A chave de API como a pessoa cola ao conectar ou trocar. Só entra, nunca sai. */
export const ChaveDoProvedor = Type.String({
  minLength: 8,
  maxLength: 400,
  pattern: "^[\\x21-\\x7e]+$",
  description: "Chave do provedor. Só entra: nunca é devolvida pela API.",
  writeOnly: true,
});

/**
 * O que entra no campo "chave": a chave de API (até 400 caracteres, sem espaço) ou o login de um plano de assinatura
 * (o token do `claude setup-token`, ou o conteúdo do arquivo de login do Codex, um JSON de alguns KB). A conferência
 * pelo tipo fica em regrasDoPedido.
 */
export const CredencialDoProvedor = Type.String({
  minLength: 8,
  maxLength: 20_000,
  description: "Chave de API ou login do plano. Só entra: nunca é devolvida pela API.",
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
    credencial: TipoDeCredencial,
    /** Os 4 últimos caracteres da chave (ou do token do plano), para reconhecer qual é. */
    finalDaChave: Type.String({ pattern: "^[\\x21-\\x7e]{4}$" }),
    situacao: SituacaoDaContaDeIa,
    /** O que deu errado no último teste ou chamada, em texto curto e sem a chave. */
    ultimoErro: OuNulo(Texto(300, "O que deu errado, sem a chave.")),
    /** Só na chave de API: a assinatura não tem custo por uso. */
    tetoMensal: OuNulo(TetoMensal),
    /** Só na assinatura: quem aceitou o aviso de termos, e quando. */
    termosAceitosPor: OuNulo(Id),
    termosAceitosEm: OuNulo(DataHora),
    /** Só na assinatura: o limite do plano acabou e volta nesta hora (até lá, os agentes usam o reserva). */
    limiteDoPlanoAte: OuNulo(DataHora),
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
  (c): Problema[] =>
    CREDENCIAIS_DO_PROVEDOR[c.provedor].includes(c.credencial)
      ? []
      : [{ caminho: "/credencial", mensagem: "este provedor não aceita este tipo de credencial" }],
  (c): Problema[] => {
    const aceite = c.termosAceitosPor !== null && c.termosAceitosEm !== null;
    if (c.credencial === "assinatura") {
      const problemas: Problema[] = [];
      if (!aceite)
        problemas.push({ caminho: "/termosAceitosEm", mensagem: "assinatura precisa do aceite dos termos" });
      if (c.tetoMensal !== null)
        problemas.push({ caminho: "/tetoMensal", mensagem: "assinatura não tem teto em dólar" });
      return problemas;
    }
    const problemas: Problema[] = [];
    if (c.termosAceitosPor !== null || c.termosAceitosEm !== null)
      problemas.push({ caminho: "/termosAceitosEm", mensagem: "só a assinatura tem aceite de termos" });
    if (c.limiteDoPlanoAte !== null)
      problemas.push({ caminho: "/limiteDoPlanoAte", mensagem: "só a assinatura tem limite do plano" });
    return problemas;
  },
];

/** A conta na lista da tela (GET /ia/contas): com quantos modelos tem e quantos estão liberados. */
export const ContaDeIaNaLista = Type.Object(
  {
    ...ContaDeIa.properties,
    modelos: Type.Integer({ minimum: 0 }),
    liberados: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ContaDeIaNaLista = Static<typeof ContaDeIaNaLista>;

export function conferirContaDeIa(valor: unknown) {
  return conferir(ContaDeIa, valor, regrasDaContaDeIa);
}

/**
 * Conectar uma conta (só quem tem "Contas de IA: criar", padrão o administrador). O núcleo testa antes de gravar.
 * Sem "credencial", vale chave_de_api. Na assinatura, "aceitoOsTermos" (o aviso AVISO_DA_ASSINATURA) é obrigatório.
 */
export const PedidoDeContaDeIa = Type.Object(
  {
    nome: NomeDaConta,
    provedor: ProvedorDeIa,
    credencial: Type.Optional(TipoDeCredencial),
    endereco: Type.Optional(OuNulo(EnderecoDoProvedor)),
    chave: CredencialDoProvedor,
    tetoMensal: Type.Optional(OuNulo(TetoMensal)),
    aceitoOsTermos: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);
export type PedidoDeContaDeIa = Static<typeof PedidoDeContaDeIa>;

/** A chave de API tem o formato curto; o login do plano pode ser um token ou o JSON do Codex. */
function problemasDaCredencial(
  credencial: TipoDeCredencial,
  provedor: ProvedorDeIa,
  chave: string,
): Problema[] {
  if (credencial === "chave_de_api")
    return /^[\x21-\x7e]{8,400}$/.test(chave)
      ? []
      : [{ caminho: "/chave", mensagem: "chave de API com até 400 caracteres e sem espaços" }];
  if (provedor === "chatgpt") {
    try {
      const login = JSON.parse(chave) as { tokens?: { refresh_token?: unknown } };
      if (typeof login?.tokens?.refresh_token === "string") return [];
    } catch {
      // cai no problema abaixo
    }
    return [{ caminho: "/chave", mensagem: "cole o conteúdo do arquivo de login do Codex (auth.json)" }];
  }
  return /^[\x21-\x7e]{8,2000}$/.test(chave)
    ? []
    : [{ caminho: "/chave", mensagem: "cole o token do plano, sem espaços" }];
}

export const regrasDoPedidoDeConta: Regra<PedidoDeContaDeIa>[] = [
  (p): Problema[] => {
    const credencial = p.credencial ?? "chave_de_api";
    if (!CREDENCIAIS_DO_PROVEDOR[p.provedor].includes(credencial))
      return [{ caminho: "/credencial", mensagem: "este provedor não aceita este tipo de credencial" }];
    const problemas = problemasDaCredencial(credencial, p.provedor, p.chave);
    if (credencial === "assinatura") {
      if (p.aceitoOsTermos !== true)
        problemas.push({ caminho: "/aceitoOsTermos", mensagem: "aceite o aviso dos termos do provedor" });
      if (p.tetoMensal !== undefined && p.tetoMensal !== null)
        problemas.push({ caminho: "/tetoMensal", mensagem: "assinatura não tem teto em dólar" });
    }
    return problemas;
  },
];

export function conferirPedidoDeContaDeIa(valor: unknown) {
  return conferir(PedidoDeContaDeIa, valor, regrasDoPedidoDeConta);
}

/**
 * Editar uma conta: nome, teto ou trocar a chave (a troca testa a nova antes de valer e segue o tipo de credencial
 * da conta). O tipo de credencial e o provedor não mudam: para isso, conecte outra conta.
 */
export const PedidoDeEditarContaDeIa = Type.Object(
  {
    nome: Type.Optional(NomeDaConta),
    tetoMensal: Type.Optional(OuNulo(TetoMensal)),
    chave: Type.Optional(CredencialDoProvedor),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarContaDeIa = Static<typeof PedidoDeEditarContaDeIa>;

/** Confere a troca de chave contra o tipo de credencial e o provedor da conta. */
export function problemasDaTrocaDeChave(conta: Pick<ContaDeIa, "credencial" | "provedor">, chave: string) {
  return problemasDaCredencial(conta.credencial, conta.provedor, chave);
}

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
  "ia.aceitou_termos",
  "ia.chegou_no_limite_do_plano",
  "agente.escolheu_modelo",
] as const;
