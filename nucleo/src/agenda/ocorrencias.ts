/**
 * As vezes de um evento num intervalo (M5-07, decisão 0041). O evento único tem uma vez; a série segue a regra da
 * recorrência das tarefas, contada a partir do dia do começo, com o fim numa data ou depois de N vezes. Cada vez tem o
 * mesmo horário e a mesma duração em dias, no fuso do evento (com o horário de verão de cada lugar). Funções puras.
 */
import type { RegraDeRecorrencia } from "@mago-os/contratos";
import { momentoNoFuso, primeiroDia } from "../rotinas/horarios.ts";
import { proximoDia } from "../tarefas/recorrencia.ts";

export interface BaseDoEvento {
  inicioDia: string;
  inicioHora: string | null;
  fimDia: string;
  fimHora: string | null;
  diaInteiro: boolean;
  fuso: string;
  regra: RegraDeRecorrencia | null;
}

export interface Ocorrencia {
  /** O dia da vez na série (o dia do começo dela). */
  dia: string;
  inicioEm: Date;
  fimEm: Date;
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function diferencaEmDias(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** O começo e o fim da vez que começa no dia. */
export function vezNoDia(e: BaseDoEvento, dia: string): Ocorrencia {
  const duracao = diferencaEmDias(e.inicioDia, e.fimDia);
  const inicioEm = momentoNoFuso(dia, e.inicioHora ?? "00:00", e.fuso);
  const fimEm = e.diaInteiro
    ? momentoNoFuso(somarDias(dia, duracao + 1), "00:00", e.fuso)
    : momentoNoFuso(somarDias(dia, duracao), e.fimHora ?? "00:00", e.fuso);
  return { dia, inicioEm, fimEm };
}

/** Voltas no máximo numa conta (uma série diária de muitos anos ainda cabe). */
const MAXIMO_DE_DIAS = 40_000;

/** As vezes que encostam no intervalo [de, ate), em ordem, até "limite". */
export function ocorrenciasEntre(e: BaseDoEvento, de: Date, ate: Date, limite = 500): Ocorrencia[] {
  const encosta = (o: Ocorrencia) => o.inicioEm.getTime() < ate.getTime() && o.fimEm.getTime() > de.getTime();
  if (!e.regra) {
    const unica = vezNoDia(e, e.inicioDia);
    return encosta(unica) ? [unica] : [];
  }
  const { ate: dataFinal, vezes, ...semFim } = e.regra;
  const regra = semFim as RegraDeRecorrencia;
  const resultado: Ocorrencia[] = [];
  let dia: string | null = primeiroDia({
    tipo: "horario",
    regra,
    horas: [e.inicioHora ?? "00:00"],
    fuso: e.fuso,
    inicio: e.inicioDia,
  });
  for (let n = 0; dia && n < MAXIMO_DE_DIAS; n++) {
    if (dataFinal != null && dia > dataFinal) break;
    if (vezes != null && n >= vezes) break;
    const vez = vezNoDia(e, dia);
    if (vez.inicioEm.getTime() >= ate.getTime()) break;
    if (encosta(vez)) {
      resultado.push(vez);
      if (resultado.length >= limite) break;
    }
    dia = proximoDia(regra, dia, 0, e.inicioDia);
  }
  return resultado;
}

/** Quantas vezes a série tem antes do dia (para dividir em "este e os seguintes" com o fim por número de vezes). */
export function vezesAntesDe(e: BaseDoEvento, dia: string): number {
  if (!e.regra) return 0;
  const { ate: dataFinal, vezes, ...semFim } = e.regra;
  const regra = semFim as RegraDeRecorrencia;
  let d: string | null = primeiroDia({
    tipo: "horario",
    regra,
    horas: [e.inicioHora ?? "00:00"],
    fuso: e.fuso,
    inicio: e.inicioDia,
  });
  let n = 0;
  while (d && d < dia && n < MAXIMO_DE_DIAS) {
    if (dataFinal != null && d > dataFinal) break;
    if (vezes != null && n >= vezes) break;
    n++;
    d = proximoDia(regra, d, 0, e.inicioDia);
  }
  return n;
}

/** O dia é uma das vezes da série (anda pela regra até ele, respeitando o fim por data e por vezes). */
export function ehOcorrencia(e: BaseDoEvento, dia: string): boolean {
  if (!e.regra) return dia === e.inicioDia;
  const { ate: dataFinal, vezes, ...semFim } = e.regra;
  const regra = semFim as RegraDeRecorrencia;
  let d: string | null = primeiroDia({
    tipo: "horario",
    regra,
    horas: [e.inicioHora ?? "00:00"],
    fuso: e.fuso,
    inicio: e.inicioDia,
  });
  for (let n = 0; d && d <= dia && n < MAXIMO_DE_DIAS; n++) {
    if (dataFinal != null && d > dataFinal) return false;
    if (vezes != null && n >= vezes) return false;
    if (d === dia) return true;
    d = proximoDia(regra, d, 0, e.inicioDia);
  }
  return false;
}
