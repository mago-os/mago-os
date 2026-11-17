/**
 * Vínculo: uma pessoa dentro de uma empresa, com perfil e situação.
 * A mesma pessoa tem um vínculo por empresa, e cada empresa define as próprias permissões.
 * O ajuste fino por módulo (ver, criar, editar...) vem no M1-06 e se apoia no perfil daqui.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, OuNulo, type Problema, type Regra } from "../comum.ts";

export const PERFIS = ["administrador", "gestor_area", "funcionario"] as const;

/** Perfil dentro da empresa. O Dono da plataforma não é um perfil: fica acima das empresas (plataforma.ts). */
export const Perfil = Type.Enum(PERFIS, {
  description: "administrador, gestor_area (gestor de uma área) ou funcionario.",
});
export type Perfil = Static<typeof Perfil>;

/**
 * Área da empresa (ex.: comercial, financeiro). Cada empresa cria as suas. O gestor cuida de uma área; o
 * funcionário pode estar numa (a equipe dele, M1-06); o administrador não tem área (vê a empresa toda).
 */
export const Area = Type.String({
  pattern: "^[a-z][a-z0-9_]{1,39}$",
  description: "Área em minúsculas, sem acento nem espaço (ex.: comercial).",
});

export const SITUACOES_VINCULO = ["convidado", "ativo", "desligado"] as const;

/** convidado: ainda não aceitou. ativo: trabalha na empresa. desligado: perdeu o acesso (M1-07). */
export const SituacaoVinculo = Type.Enum(SITUACOES_VINCULO, {
  description: "convidado: ainda não aceitou. ativo: trabalha na empresa. desligado: perdeu o acesso.",
});

export const Vinculo = Type.Object(
  {
    id: Id,
    pessoaId: Id,
    empresaId: Id,
    perfil: Perfil,
    area: OuNulo(Area),
    situacao: SituacaoVinculo,
    convidadoEm: DataHora,
    entrouEm: OuNulo(DataHora),
    desligadoEm: OuNulo(DataHora),
  },
  { additionalProperties: false, description: "Uma pessoa dentro de uma empresa, com perfil e situação." },
);
export type Vinculo = Static<typeof Vinculo>;

/** Regras que o formato sozinho não garante. */
export const regrasDoVinculo: Regra<Vinculo>[] = [
  (v) => {
    if (v.perfil === "gestor_area" && v.area === null) {
      return [{ caminho: "/area", mensagem: "gestor de área precisa de uma área" }];
    }
    if (v.perfil === "administrador" && v.area !== null) {
      return [{ caminho: "/area", mensagem: "administrador não tem área: vê a empresa toda" }];
    }
    return [];
  },
  (v) => {
    const problemas: Problema[] = [];
    if (v.situacao === "convidado" && (v.entrouEm !== null || v.desligadoEm !== null)) {
      problemas.push({ caminho: "/situacao", mensagem: "convidado ainda não entrou nem saiu" });
    }
    if (v.situacao === "ativo" && (v.entrouEm === null || v.desligadoEm !== null)) {
      problemas.push({ caminho: "/situacao", mensagem: "ativo precisa da data de entrada e não tem saída" });
    }
    if (v.situacao === "desligado" && v.desligadoEm === null) {
      problemas.push({ caminho: "/desligadoEm", mensagem: "desligado precisa da data de saída" });
    }
    return problemas;
  },
  (v) => {
    const problemas: Problema[] = [];
    if (v.entrouEm !== null && Date.parse(v.entrouEm) < Date.parse(v.convidadoEm)) {
      problemas.push({ caminho: "/entrouEm", mensagem: "a entrada não pode ser antes do convite" });
    }
    const inicio = v.entrouEm ?? v.convidadoEm;
    if (v.desligadoEm !== null && Date.parse(v.desligadoEm) < Date.parse(inicio)) {
      problemas.push({ caminho: "/desligadoEm", mensagem: "a saída não pode ser antes da entrada" });
    }
    return problemas;
  },
];

export function conferirVinculo(valor: unknown) {
  return conferir(Vinculo, valor, regrasDoVinculo);
}
