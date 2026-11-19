/**
 * A conta da recorrência (M3-03): dado o dia do prazo de agora e a regra, qual é o dia do próximo prazo.
 *
 * Só dias do calendário, sem hora nem fuso: a hora e o fuso do prazo continuam os mesmos, e o banco calcula o
 * momento certo no fuso (com o horário de verão de cada lugar). Função pura, fácil de testar.
 */
import type { RegraDeRecorrencia } from "@mago-os/contratos";

/** "AAAA-MM-DD" para [ano, mês (1 a 12), dia]. */
function partes(dia: string): [number, number, number] {
  const [a, m, d] = dia.split("-").map(Number);
  return [a as number, m as number, d as number];
}

function texto(a: number, m: number, d: number): string {
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Quantos dias tem o mês (1 a 12) do ano. */
export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  const data = new Date(Date.UTC(a, m - 1, d + n));
  return texto(data.getUTCFullYear(), data.getUTCMonth() + 1, data.getUTCDate());
}

/** Dia da semana: 0 = domingo ... 6 = sábado. */
function diaDaSemana(dia: string): number {
  const [a, m, d] = partes(dia);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Diferença em dias entre dois dias (b - a). */
export function diferencaEmDias(a: string, b: string): number {
  const [a1, m1, d1] = partes(a);
  const [a2, m2, d2] = partes(b);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** O mês "meses" depois, no dia pedido (31 vira o último dia dos meses mais curtos). */
function somarMeses(dia: string, meses: number, diaDoMes: number): string {
  const [a, m] = partes(dia);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return texto(ano, mes, Math.min(diaDoMes, diasNoMes(ano, mes)));
}

/**
 * O dia do próximo prazo, ou nulo quando a recorrência acabou (passou do "até" ou das "vezes").
 * "ocorrencia" é a vez atual (1 na primeira); "diaOriginal" é o dia do prazo da primeira vez, que guarda o dia do mês
 * e do ano quando a regra não diz (assim um prazo no dia 31 volta ao 31 depois de fevereiro).
 */
export function proximoDia(
  regra: RegraDeRecorrencia,
  diaAtual: string,
  ocorrencia: number,
  diaOriginal: string = diaAtual,
): string | null {
  if (regra.vezes != null && ocorrencia >= regra.vezes) return null;
  const n = regra.intervalo;
  let proximo: string;
  switch (regra.frequencia) {
    case "diaria":
      proximo = somarDias(diaAtual, n);
      break;
    case "semanal": {
      const dias = [...(regra.diasDaSemana ?? [diaDaSemana(diaOriginal)])].sort((x, y) => x - y);
      const hoje = diaDaSemana(diaAtual);
      const mesmaSemana = dias.find((d) => d > hoje);
      if (mesmaSemana !== undefined) {
        proximo = somarDias(diaAtual, mesmaSemana - hoje);
      } else {
        // Volta ao domingo desta semana, pula "n" semanas e vai ao primeiro dia escolhido.
        proximo = somarDias(diaAtual, -hoje + 7 * n + (dias[0] as number));
      }
      break;
    }
    case "mensal":
      proximo = somarMeses(diaAtual, n, regra.diaDoMes ?? (partes(diaOriginal)[2] as number));
      break;
    case "anual": {
      const [, mesOriginal, diaDoOriginal] = partes(diaOriginal);
      const [ano] = partes(diaAtual);
      const alvo = ano + n;
      proximo = texto(alvo, mesOriginal, Math.min(diaDoOriginal, diasNoMes(alvo, mesOriginal)));
      break;
    }
  }
  if (regra.ate != null && proximo > regra.ate) return null;
  return proximo;
}
