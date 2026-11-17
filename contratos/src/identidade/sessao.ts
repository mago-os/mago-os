/**
 * Sessão: um aparelho conectado. O token da sessão nunca faz parte do contrato: só o servidor conhece.
 * Lista, desconexão e expiração por inatividade vêm no M1-08; o 2FA no M1-05.
 */
import { type Static, Type } from "typebox";
import { conferir, DataHora, Id, Ip, OuNulo, type Problema, type Regra, Texto } from "../comum.ts";

/** Por quantos dias um aparelho pode ficar "confiável" depois do 2FA (spec M1-05). */
export const DIAS_APARELHO_CONFIAVEL = 30;

export const DoisFatores = Type.Object(
  {
    verificadoEm: OuNulo(DataHora),
    aparelhoConfiavelAte: OuNulo(DataHora),
  },
  {
    additionalProperties: false,
    description: "Se a sessão passou pelo 2FA e até quando o aparelho é confiável.",
  },
);

export const Sessao = Type.Object(
  {
    id: Id,
    pessoaId: Id,
    empresaId: OuNulo(Id),
    aparelho: Texto(100, "Nome do aparelho (ex.: iPhone do Sandro)."),
    navegador: Texto(300, "Navegador e sistema, resumidos do user agent."),
    ip: Ip,
    criadaEm: DataHora,
    ultimoUsoEm: DataHora,
    expiraEm: DataHora,
    encerradaEm: OuNulo(DataHora),
    doisFatores: DoisFatores,
  },
  {
    additionalProperties: false,
    description:
      "Um aparelho conectado. empresaId é a empresa ativa naquele momento (nulo antes de escolher).",
  },
);
export type Sessao = Static<typeof Sessao>;

const DIA_MS = 24 * 60 * 60 * 1000;

export const regrasDaSessao: Regra<Sessao>[] = [
  (s) => {
    const problemas: Problema[] = [];
    const criada = Date.parse(s.criadaEm);
    if (Date.parse(s.ultimoUsoEm) < criada) {
      problemas.push({ caminho: "/ultimoUsoEm", mensagem: "o último uso não pode ser antes da criação" });
    }
    if (Date.parse(s.expiraEm) <= criada) {
      problemas.push({ caminho: "/expiraEm", mensagem: "a sessão precisa expirar depois de criada" });
    }
    if (s.encerradaEm !== null && Date.parse(s.encerradaEm) < criada) {
      problemas.push({ caminho: "/encerradaEm", mensagem: "o encerramento não pode ser antes da criação" });
    }
    return problemas;
  },
  ({ doisFatores: f }) => {
    if (f.aparelhoConfiavelAte === null) return [];
    if (f.verificadoEm === null) {
      return [{ caminho: "/doisFatores/aparelhoConfiavelAte", mensagem: "aparelho confiável exige 2FA" }];
    }
    const limite = Date.parse(f.verificadoEm) + DIAS_APARELHO_CONFIAVEL * DIA_MS;
    if (Date.parse(f.aparelhoConfiavelAte) > limite) {
      return [
        {
          caminho: "/doisFatores/aparelhoConfiavelAte",
          mensagem: `o aparelho só pode ser confiável por até ${DIAS_APARELHO_CONFIAVEL} dias`,
        },
      ];
    }
    return [];
  },
];

export function conferirSessao(valor: unknown) {
  return conferir(Sessao, valor, regrasDaSessao);
}
