/**
 * Evento de auditoria: o registro de "quem fez o quê, em quê, de onde e quando".
 *
 * Os eventos formam uma corrente: cada um guarda a "impressão digital" (hash SHA-256) do anterior.
 * Se alguém alterar, apagar ou inserir um registro no meio, a corrente quebra e verificarCorrente percebe.
 * Há uma corrente por empresa (empresaId) e uma da plataforma (empresaId nulo), cada uma com a própria
 * sequência, para que cada empresa confira a sua sem ver a das outras. A gravação e a cópia fora do
 * alcance dos administradores vêm no M1-09.
 *
 * O hash usa o Web Crypto (globalThis.crypto), que existe no Node e no navegador.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, Ip, OuNulo, type Problema, Rastreio, type Regra, Texto } from "./comum.ts";

/** Quem fez: uma pessoa, um agente (M2) ou o próprio sistema (ex.: a fila ou a expiração de sessões). */
export const Ator = Type.Union(
  [
    Type.Object({ tipo: Type.Literal("pessoa"), pessoaId: Id }, { additionalProperties: false }),
    Type.Object({ tipo: Type.Literal("agente"), agenteId: Id }, { additionalProperties: false }),
    Type.Object(
      { tipo: Type.Literal("sistema"), servico: Type.String({ pattern: "^[a-z][a-z0-9_-]{1,39}$" }) },
      { additionalProperties: false },
    ),
  ],
  { description: "Quem fez a ação: pessoa, agente ou sistema." },
);
export type Ator = Static<typeof Ator>;

/**
 * Nome da ação, sempre "assunto.verbo" em minúsculas (ex.: acesso.entrou, vinculo.convidou).
 * Cada módulo declara as próprias ações; as de identidade estão em ACOES_IDENTIDADE.
 */
export const Acao = Type.String({
  pattern: "^[a-z][a-z_]{1,39}\\.[a-z][a-z_]{1,39}$",
  description: "Ação no formato assunto.verbo (ex.: acesso.entrou).",
});

/** Ações de identidade já combinadas. As tarefas do M1 usam estes nomes, e a lista cresce com elas. */
export const ACOES_IDENTIDADE = [
  "acesso.entrou",
  "acesso.saiu",
  "acesso.falhou",
  "acesso.travou",
  "senha.trocou",
  "senha.pediu_recuperacao",
  "dois_fatores.ativou",
  "dois_fatores.desativou",
  "dois_fatores.verificou",
  "pessoa.criou",
  "pessoa.alterou",
  "pessoa.bloqueou",
  "pessoa.desbloqueou",
  "empresa.criou",
  "empresa.alterou",
  "empresa.suspendeu",
  "empresa.reativou",
  "empresa.trocou_ativa",
  "vinculo.convidou",
  "vinculo.aceitou",
  "vinculo.mudou_perfil",
  "vinculo.desligou",
  "sessao.criou",
  "sessao.encerrou",
  "sessao.expirou",
  "sessao.aparelho_novo",
  "plataforma.concedeu_papel",
  "plataforma.retirou_papel",
] as const;

/** O item afetado (ex.: { tipo: "vinculo", id: "..." }). */
export const Alvo = Type.Object(
  {
    tipo: Type.String({ pattern: "^[a-z][a-z0-9_]{1,39}$" }),
    id: Texto(100, "Identificador do item afetado."),
  },
  { additionalProperties: false },
);

export const CANAIS = ["painel", "api", "telegram", "mcp", "sistema"] as const;

/** De onde veio: o canal sempre; IP e aparelho quando houver (o sistema não tem). */
export const Origem = Type.Object(
  {
    canal: Type.Enum(CANAIS),
    ip: OuNulo(Ip),
    aparelho: OuNulo(Texto(100, "Nome do aparelho.")),
  },
  { additionalProperties: false },
);

/** Impressão digital SHA-256 em hexadecimal. */
export const Hash = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const EventoAuditoria = Type.Object(
  {
    id: Id,
    empresaId: OuNulo(Id),
    sequencia: Type.Integer({ minimum: 1, description: "Posição na corrente, começando em 1." }),
    ator: Ator,
    acao: Acao,
    alvo: OuNulo(Alvo),
    origem: Origem,
    ocorridoEm: DataHora,
    rastreio: OuNulo(Rastreio),
    detalhes: Type.Record(Type.String(), Type.Unknown(), {
      description: "Informações extras da ação. Nunca senha, token, código ou dado sensível.",
    }),
    hashAnterior: OuNulo(Hash),
    hash: Hash,
  },
  { additionalProperties: false, description: "Registro encadeado de quem fez o quê." },
);
export type EventoAuditoria = Static<typeof EventoAuditoria>;

/** Partes de nomes que nunca podem aparecer nos detalhes (senha, token, código de 2FA, cartão etc.). */
const CAMPOS_PROIBIDOS = /senha|password|token|segredo|secret|otp|codigo_2fa|cartao|cvv|cpf/i;

function camposProibidos(valor: unknown, caminho: string): Problema[] {
  if (Array.isArray(valor)) return valor.flatMap((item, i) => camposProibidos(item, `${caminho}/${i}`));
  if (valor === null || typeof valor !== "object") return [];
  return Object.entries(valor).flatMap(([chave, item]) => {
    const aqui = `${caminho}/${chave}`;
    const proprio = CAMPOS_PROIBIDOS.test(chave)
      ? [{ caminho: aqui, mensagem: "dado sensível não entra na auditoria" }]
      : [];
    return [...proprio, ...camposProibidos(item, aqui)];
  });
}

export const regrasDoEvento: Regra<EventoAuditoria>[] = [
  (e) => camposProibidos(e.detalhes, "/detalhes"),
  (e) => {
    if (e.sequencia === 1 && e.hashAnterior !== null) {
      return [{ caminho: "/hashAnterior", mensagem: "o primeiro evento da corrente não tem anterior" }];
    }
    if (e.sequencia > 1 && e.hashAnterior === null) {
      return [{ caminho: "/hashAnterior", mensagem: "só o primeiro evento da corrente fica sem anterior" }];
    }
    return [];
  },
];

export function conferirEventoAuditoria(valor: unknown) {
  return conferir(EventoAuditoria, valor, regrasDoEvento);
}

/**
 * Texto canônico do evento (tudo menos o próprio hash): JSON sem espaços, com as chaves em ordem
 * alfabética em todos os níveis. É o que entra no SHA-256. Mudar esta função quebra todas as correntes
 * já gravadas: só com nota de decisão e subindo VERSAO_CONTRATOS.
 */
export function textoCanonico(evento: Omit<EventoAuditoria, "hash">): string {
  const { hash: _ignorado, ...semHash } = evento as EventoAuditoria;
  return canonico(semHash);
}

function canonico(valor: unknown): string {
  if (valor === null || typeof valor === "boolean" || typeof valor === "string") return JSON.stringify(valor);
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error("Auditoria: número inválido nos dados");
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (typeof valor === "object") {
    const partes = Object.keys(valor)
      .filter((chave) => (valor as Record<string, unknown>)[chave] !== undefined)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${canonico((valor as Record<string, unknown>)[chave])}`);
    return `{${partes.join(",")}}`;
  }
  throw new Error(`Auditoria: tipo de dado não aceito (${typeof valor})`);
}

/** Calcula a impressão digital (SHA-256 em hexadecimal) do evento. */
export async function calcularHash(evento: Omit<EventoAuditoria, "hash">): Promise<string> {
  const bytes = new TextEncoder().encode(textoCanonico(evento));
  const resumo = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ResultadoCorrente =
  | { integra: true; eventos: number }
  | { integra: false; sequencia: number; motivo: string };

/**
 * Confere uma corrente inteira (os eventos de uma mesma empresa, ou da plataforma, desde o primeiro).
 * Para no primeiro problema e diz em que posição a corrente quebrou.
 */
export async function verificarCorrente(eventos: readonly EventoAuditoria[]): Promise<ResultadoCorrente> {
  const ordenados = [...eventos].sort((a, b) => a.sequencia - b.sequencia);
  let anterior: EventoAuditoria | null = null;
  for (const [i, evento] of ordenados.entries()) {
    const quebra = (motivo: string): ResultadoCorrente => ({
      integra: false,
      sequencia: evento.sequencia,
      motivo,
    });
    if (evento.sequencia !== i + 1) return quebra("falta um evento antes deste");
    if (anterior !== null && evento.empresaId !== anterior.empresaId) {
      return quebra("evento de outra corrente misturado");
    }
    if (evento.hashAnterior !== (anterior?.hash ?? null)) return quebra("não aponta para o evento anterior");
    if ((await calcularHash(evento)) !== evento.hash) return quebra("o conteúdo foi alterado");
    anterior = evento;
  }
  return { integra: true, eventos: ordenados.length };
}
