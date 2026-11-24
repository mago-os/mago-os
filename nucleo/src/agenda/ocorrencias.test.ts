import { describe, expect, it } from "vitest";
import { type BaseDoEvento, ehOcorrencia, ocorrenciasEntre, vezesAntesDe } from "./ocorrencias.ts";

const reuniao: BaseDoEvento = {
  inicioDia: "2026-11-26",
  inicioHora: "15:00",
  fimDia: "2026-11-26",
  fimHora: "16:00",
  diaInteiro: false,
  fuso: "America/Sao_Paulo",
  regra: null,
};

const iso = (d: Date) => d.toISOString();

describe("ocorrências da agenda", () => {
  it("evento único: só quando encosta no intervalo", () => {
    const de = new Date("2026-11-23T00:00:00Z");
    const ate = new Date("2026-11-30T00:00:00Z");
    expect(ocorrenciasEntre(reuniao, de, ate).map((o) => [o.dia, iso(o.inicioEm), iso(o.fimEm)])).toEqual([
      ["2026-11-26", "2026-11-26T18:00:00.000Z", "2026-11-26T19:00:00.000Z"],
    ]);
    expect(ocorrenciasEntre(reuniao, new Date("2026-11-27T00:00:00Z"), ate)).toEqual([]);
  });

  it("dia inteiro vai do começo do primeiro dia ao começo do dia seguinte ao último, no fuso", () => {
    const folga: BaseDoEvento = {
      ...reuniao,
      inicioHora: null,
      fimHora: null,
      fimDia: "2026-11-27",
      diaInteiro: true,
    };
    const [o] = ocorrenciasEntre(folga, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
    expect([iso(o?.inicioEm as Date), iso(o?.fimEm as Date)]).toEqual([
      "2026-11-26T03:00:00.000Z",
      "2026-11-28T03:00:00.000Z",
    ]);
  });

  it("toda semana, com o horário de verão de outro país, e o fim depois de N vezes", () => {
    const ny: BaseDoEvento = {
      ...reuniao,
      inicioDia: "2026-10-26",
      fimDia: "2026-10-26",
      inicioHora: "09:00",
      fimHora: "09:30",
      fuso: "America/New_York",
      regra: { frequencia: "semanal", intervalo: 1, vezes: 3 },
    };
    const vezes = ocorrenciasEntre(ny, new Date("2026-10-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"));
    // Nova York sai do horário de verão em 1/11/2026: 13h UTC antes, 14h depois.
    expect(vezes.map((o) => iso(o.inicioEm))).toEqual([
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ]);
    expect(vezesAntesDe(ny, "2026-11-09")).toBe(2);
    expect(ehOcorrencia(ny, "2026-11-02")).toBe(true);
    expect(ehOcorrencia(ny, "2026-11-03")).toBe(false);
  });
});
