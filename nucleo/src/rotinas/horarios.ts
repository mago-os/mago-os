/**
 * A conta dos horários das rotinas (M5-05, decisão 0039): dado o gatilho, qual é a próxima vez depois de um momento.
 *
 * Os dias seguem a regra da recorrência das tarefas (proximoDia), contada a partir do dia de início; em cada dia, os
 * horários marcados, no fuso do gatilho, com o horário de verão de cada lugar. Uma hora que não existe no dia em que o
 * relógio adianta vai para a primeira que existe depois (como o PostgreSQL faz). Funções puras, fáceis de testar.
 */
import type { GatilhoPorHorario, RegraDeRecorrencia } from "@mago-os/contratos";
import { diasNoMes, proximoDia } from "../tarefas/recorrencia.ts";

const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatos.set(fuso, f);
  }
  return f;
}

/** Quanto o relógio do fuso está à frente do UTC naquele momento, em milissegundos. */
function diferencaDoFuso(fuso: string, momento: number): number {
  const p = Object.fromEntries(
    formato(fuso)
      .formatToParts(new Date(momento))
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return local - Math.floor(momento / 1000) * 1000;
}

/** O momento em que o relógio do fuso marca o dia e a hora. */
export function momentoNoFuso(dia: string, hora: string, fuso: string): Date {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  const [h, mi] = hora.split(":").map(Number) as [number, number];
  const comoUtc = Date.UTC(a, m - 1, d, h, mi);
  const primeira = comoUtc - diferencaDoFuso(fuso, comoUtc);
  const segunda = comoUtc - diferencaDoFuso(fuso, primeira);
  if (segunda === primeira) return new Date(primeira);
  // Perto da troca do horário de verão: fica com a que dá a hora certa; sem nenhuma (a hora não existe), a depois.
  const certa = [primeira, segunda].find((t) => t + diferencaDoFuso(fuso, t) === comoUtc);
  return new Date(certa ?? Math.max(primeira, segunda));
}

/** O dia (AAAA-MM-DD) que o relógio do fuso marca no momento. */
export function diaNoFuso(momento: Date, fuso: string): string {
  const p = Object.fromEntries(
    formato(fuso)
      .formatToParts(momento)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function diaDaSemana(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** A regra sem o fim (o fim por data e por vezes é contado aqui, não pelo proximoDia). */
function semFim(regra: RegraDeRecorrencia): RegraDeRecorrencia {
  const { ate: _a, vezes: _v, ...resto } = regra;
  return resto;
}

/** O primeiro dia da série, a partir do início (inclusive). */
export function primeiroDia(g: GatilhoPorHorario): string {
  const regra = semFim(g.regra);
  const inicio = g.inicio;
  switch (regra.frequencia) {
    case "semanal": {
      const dias = regra.diasDaSemana ?? [diaDaSemana(inicio)];
      return dias.includes(diaDaSemana(inicio)) ? inicio : (proximoDia(regra, inicio, 0, inicio) as string);
    }
    case "mensal": {
      const [a, m, d] = inicio.split("-").map(Number) as [number, number, number];
      const alvo = Math.min(regra.diaDoMes ?? d, diasNoMes(a, m));
      return alvo === d
        ? inicio
        : alvo > d
          ? `${inicio.slice(0, 8)}${String(alvo).padStart(2, "0")}`
          : (proximoDia(regra, inicio, 0, inicio) as string);
    }
    default:
      return inicio;
  }
}

/** Dias percorridos no máximo numa conta (uma rotina diária de muitos anos atrás ainda cabe). */
const MAXIMO_DE_DIAS = 40_000;

/**
 * A próxima vez estritamente depois de "depoisDe", ou nulo quando a série acabou (passou da data final ou das vezes).
 * "vezes" é quantas vezes a rotina já rodou pelo horário.
 */
export function proximaVez(g: GatilhoPorHorario, depoisDe: Date, vezes = 0): Date | null {
  if (g.regra.vezes != null && vezes >= g.regra.vezes) return null;
  const regra = semFim(g.regra);
  const horas = [...g.horas].sort();
  // Começa no dia de início ou, se ele já passou, alguns dias antes do dia de agora no fuso (sem pular nenhum).
  let dia: string | null = primeiroDia(g);
  const hoje = diaNoFuso(depoisDe, g.fuso);
  for (let i = 0; dia && i < MAXIMO_DE_DIAS; i++) {
    if (g.regra.ate != null && dia > g.regra.ate) return null;
    if (dia >= diaAnterior(hoje)) {
      for (const hora of horas) {
        const momento = momentoNoFuso(dia, hora, g.fuso);
        if (momento.getTime() > depoisDe.getTime()) return momento;
      }
    }
    dia = proximoDia(regra, dia, 0, g.inicio);
  }
  return null;
}

function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  const data = new Date(Date.UTC(a, m - 1, d - 1));
  return data.toISOString().slice(0, 10);
}

/**
 * A última vez que já chegou (até "agora", inclusive) a partir de uma vez marcada, e a próxima depois de agora, numa
 * passada só: o servidor que ficou fora do ar roda uma vez só, a última que perdeu, e marca a seguinte. Se a marcada
 * ainda não chegou, devolve nulo na última. "vezes" é quantas vezes a rotina já rodou pelo horário.
 */
export function ultimaEProxima(
  g: GatilhoPorHorario,
  marcada: Date,
  agora: Date,
  vezes = 0,
): { ultima: Date | null; proxima: Date | null } {
  if (marcada.getTime() > agora.getTime()) return { ultima: null, proxima: marcada };
  const regra = semFim(g.regra);
  const horas = [...g.horas].sort();
  const desde = diaAnterior(diaNoFuso(marcada, g.fuso));
  let ultima: Date | null = null;
  let dia: string | null = primeiroDia(g);
  for (let i = 0; dia && i < MAXIMO_DE_DIAS; i++) {
    if (g.regra.ate != null && dia > g.regra.ate) break;
    if (dia >= desde) {
      for (const hora of horas) {
        const momento = momentoNoFuso(dia, hora, g.fuso);
        if (momento.getTime() < marcada.getTime()) continue;
        if (momento.getTime() <= agora.getTime()) ultima = momento;
        else {
          // Depois de rodar a última, já foram vezes + 1.
          const acabou = g.regra.vezes != null && vezes + 1 >= g.regra.vezes;
          return { ultima, proxima: acabou ? null : momento };
        }
      }
    }
    dia = proximoDia(regra, dia, 0, g.inicio);
  }
  return { ultima, proxima: null };
}
