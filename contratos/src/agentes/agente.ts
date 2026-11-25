/**
 * Agente (M2-03): um agente de IA que trabalha numa empresa, sempre com uma pessoa responsável.
 *
 * No M2 só existe o agente externo: ele roda fora do Mago OS (ex.: Claude no Mac, Hermes na VPS01) e
 * entra pelo MCP com uma chave própria. A chave tem contrato próprio na M2-04 (é segurança, aprovação
 * à parte). M4-02: o agente interno roda dentro do Mago OS (coordenador ou especialista), com papel, especialidade e
 * a quem responde (contrato em internos.ts).
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";
import { Especialidade, PapelDeAgente } from "./internos.ts";

export const TIPOS_AGENTE = ["externo", "interno"] as const;
export const TipoAgente = Type.Enum(TIPOS_AGENTE, {
  description: "externo: roda fora do Mago OS e entra pelo MCP. interno: roda dentro do Mago OS (M4-02).",
});
export type TipoAgente = Static<typeof TipoAgente>;

export const SITUACOES_AGENTE = ["ativo", "pausado", "desligado"] as const;
/**
 * ativo: recebe e faz tarefas. pausado: não recebe tarefa nova, mas as chaves continuam guardadas.
 * desligado: para na hora, as chaves deixam de valer e as tarefas pegadas voltam para A fazer.
 */
export const SituacaoAgente = Type.Enum(SITUACOES_AGENTE, {
  description: "ativo, pausado (sem tarefa nova) ou desligado (para na hora e as chaves deixam de valer).",
});
export type SituacaoAgente = Static<typeof SituacaoAgente>;

/** Minutos sem sinal de vida até a tarefa pegada voltar para A fazer (M2-04). Padrão 15. */
export const MinutosSemSinal = Type.Integer({
  minimum: 2,
  maximum: 1440,
  description: "Minutos sem sinal até a tarefa voltar para a fila (padrão 15).",
});
export const MINUTOS_SEM_SINAL_PADRAO = 15;

const Nome = Texto(80, "Nome do agente como aparece nas telas (ex.: Claude no Mac).");
const Descricao = Texto(1000, "Para que serve o agente.");
const OndeRoda = Texto(100, "Onde o agente roda, em texto livre (ex.: VPS01, Mac do Sandro).");

/**
 * Por onde o agente externo entra com a chave dele (M7-02, decisão 0047): só pelo MCP, só pela API pública ou pelos
 * dois (padrão). O agente interno não usa chave: fica "os_dois" e não muda nada.
 */
export const CANAIS_DO_AGENTE = ["mcp", "api", "os_dois"] as const;
export const CanaisDoAgente = Type.Enum(CANAIS_DO_AGENTE, {
  description: "mcp (só MCP), api (só a API pública) ou os_dois (padrão).",
});
export type CanaisDoAgente = Static<typeof CanaisDoAgente>;

export const Agente = Type.Object(
  {
    id: Id,
    empresaId: Id,
    nome: Nome,
    descricao: OuNulo(Descricao),
    tipo: TipoAgente,
    ondeRoda: OuNulo(OndeRoda),
    /** Pessoa da empresa que responde pelo agente e recebe os avisos dele. Obrigatória. */
    responsavelId: Id,
    /** Só do agente interno: coordenador ou especialista, a especialidade e a quem ele responde. */
    papel: OuNulo(PapelDeAgente),
    especialidade: OuNulo(Especialidade),
    respondeAId: OuNulo(Id),
    situacao: SituacaoAgente,
    minutosSemSinal: MinutosSemSinal,
    /** Por onde a chave dele entra (M7-02). */
    canais: CanaisDoAgente,
    ultimoSinalEm: OuNulo(DataHora),
    criadoEm: DataHora,
    atualizadoEm: DataHora,
    desligadoEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Agente de IA de uma empresa." },
);
export type Agente = Static<typeof Agente>;

export const regrasDoAgente: Regra<Agente>[] = [
  (a): Problema[] => {
    if (a.tipo === "externo")
      return a.papel !== null || a.especialidade !== null || a.respondeAId !== null
        ? [{ caminho: "/papel", mensagem: "agente externo não tem papel nem hierarquia" }]
        : [];
    if (a.papel === null) return [{ caminho: "/papel", mensagem: "agente interno precisa do papel" }];
    if (a.papel === "coordenador" && (a.especialidade !== null || a.respondeAId !== null))
      return [
        { caminho: "/papel", mensagem: "o coordenador não tem especialidade nem responde a outro agente" },
      ];
    if (a.papel === "especialista" && (a.especialidade === null || a.respondeAId === null))
      return [
        {
          caminho: "/especialidade",
          mensagem: "o especialista tem especialidade e responde a um coordenador",
        },
      ];
    if (a.respondeAId === a.id)
      return [{ caminho: "/respondeAId", mensagem: "o agente não responde a si mesmo" }];
    return [];
  },
  (a): Problema[] => {
    if (a.situacao === "desligado" && a.desligadoEm === null) {
      return [{ caminho: "/desligadoEm", mensagem: "agente desligado precisa da data" }];
    }
    if (a.situacao !== "desligado" && a.desligadoEm !== null) {
      return [{ caminho: "/desligadoEm", mensagem: "só agente desligado tem data de desligamento" }];
    }
    return [];
  },
];

export function conferirAgente(valor: unknown) {
  return conferir(Agente, valor, regrasDoAgente);
}

/** O que a API recebe para cadastrar um agente (só o administrador). */
export const PedidoDeAgente = Type.Object(
  {
    nome: Nome,
    descricao: Type.Optional(OuNulo(Descricao)),
    ondeRoda: Type.Optional(OuNulo(OndeRoda)),
    responsavelId: Id,
    minutosSemSinal: Type.Optional(MinutosSemSinal),
  },
  { additionalProperties: false },
);
export type PedidoDeAgente = Static<typeof PedidoDeAgente>;

/** Editar um agente: só o que se pode mudar. Situação muda pelas ações pausar, retomar e desligar. */
export const PedidoDeEditarAgente = Type.Object(
  {
    nome: Type.Optional(Nome),
    descricao: Type.Optional(OuNulo(Descricao)),
    ondeRoda: Type.Optional(OuNulo(OndeRoda)),
    responsavelId: Type.Optional(Id),
    minutosSemSinal: Type.Optional(MinutosSemSinal),
    canais: Type.Optional(CanaisDoAgente),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type PedidoDeEditarAgente = Static<typeof PedidoDeEditarAgente>;

/** Ações de auditoria dos agentes (M2-03 e M2-04). As da chave entram com o contrato da chave. */
export const ACOES_AGENTES = [
  "agente.cadastrou",
  "agente.editou",
  "agente.pausou",
  "agente.retomou",
  "agente.desligou",
  "agente.sem_sinal",
  "agente.passou_do_limite",
] as const;
