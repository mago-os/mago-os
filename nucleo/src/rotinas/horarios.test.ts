import type { GatilhoPorHorario } from "@mago-os/contratos";
import { describe, expect, it } from "vitest";
import { diaNoFuso, momentoNoFuso, primeiroDia, proximaVez, ultimaEProxima } from "./horarios.ts";

const segundaAs8: GatilhoPorHorario = {
  tipo: "horario",
  regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [1] },
  horas: ["08:00"],
  fuso: "America/Sao_Paulo",
  inicio: "2026-11-20",
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("horários das rotinas", () => {
  it("converte a hora do fuso, com o horário de verão de cada lugar", () => {
    expect(iso(momentoNoFuso("2026-11-23", "08:00", "America/Sao_Paulo"))).toBe("2026-11-23T11:00:00.000Z");
    // Nova York: verão até 1/11/2026 (UTC-4), inverno depois (UTC-5).
    expect(iso(momentoNoFuso("2026-10-30", "09:00", "America/New_York"))).toBe("2026-10-30T13:00:00.000Z");
    expect(iso(momentoNoFuso("2026-11-02", "09:00", "America/New_York"))).toBe("2026-11-02T14:00:00.000Z");
    // 8/3/2026 às 2h30 não existe em Nova York (o relógio pula das 2h para as 3h): vai para depois.
    expect(iso(momentoNoFuso("2026-03-08", "02:30", "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
    expect(diaNoFuso(new Date("2026-11-23T01:00:00Z"), "America/Sao_Paulo")).toBe("2026-11-22");
  });

  it("toda segunda às 8h, começando numa sexta", () => {
    expect(primeiroDia(segundaAs8)).toBe("2026-11-23");
    expect(iso(proximaVez(segundaAs8, new Date("2026-11-20T12:00:00Z")))).toBe("2026-11-23T11:00:00.000Z");
    expect(iso(proximaVez(segundaAs8, new Date("2026-11-23T11:00:00Z")))).toBe("2026-11-30T11:00:00.000Z");
  });

  it("vários horários no dia, e a cada 2 dias", () => {
    const g: GatilhoPorHorario = {
      ...segundaAs8,
      regra: { frequencia: "diaria", intervalo: 2 },
      horas: ["18:00", "09:00"],
      fuso: "Europe/Lisbon",
      inicio: "2026-11-23",
    };
    expect(iso(proximaVez(g, new Date("2026-11-23T00:00:00Z")))).toBe("2026-11-23T09:00:00.000Z");
    expect(iso(proximaVez(g, new Date("2026-11-23T09:00:00Z")))).toBe("2026-11-23T18:00:00.000Z");
    expect(iso(proximaVez(g, new Date("2026-11-23T18:00:00Z")))).toBe("2026-11-25T09:00:00.000Z");
  });

  it("todo mês no dia 31 cai no último dia dos meses curtos", () => {
    const g: GatilhoPorHorario = {
      ...segundaAs8,
      regra: { frequencia: "mensal", intervalo: 1, diaDoMes: 31 },
      fuso: "UTC",
      inicio: "2027-01-31",
    };
    expect(iso(proximaVez(g, new Date("2027-02-01T00:00:00Z")))).toBe("2027-02-28T08:00:00.000Z");
    // Começando no meio do mês, o primeiro é no mesmo mês.
    expect(primeiroDia({ ...g, inicio: "2027-04-10" })).toBe("2027-04-30");
  });

  it("para na data final e depois de tantas vezes", () => {
    const g: GatilhoPorHorario = { ...segundaAs8, regra: { ...segundaAs8.regra, ate: "2026-11-30" } };
    expect(iso(proximaVez(g, new Date("2026-11-23T11:00:00Z")))).toBe("2026-11-30T11:00:00.000Z");
    expect(proximaVez(g, new Date("2026-11-30T11:00:00Z"))).toBeNull();
    const tresVezes: GatilhoPorHorario = { ...segundaAs8, regra: { ...segundaAs8.regra, vezes: 3 } };
    expect(proximaVez(tresVezes, new Date("2026-11-23T11:00:00Z"), 2)).not.toBeNull();
    expect(proximaVez(tresVezes, new Date("2026-11-23T11:00:00Z"), 3)).toBeNull();
  });

  it("servidor fora do ar: roda só a última vez perdida e marca a seguinte", () => {
    const todoDia: GatilhoPorHorario = { ...segundaAs8, regra: { frequencia: "diaria", intervalo: 1 } };
    const r = ultimaEProxima(todoDia, new Date("2026-11-20T11:00:00Z"), new Date("2026-11-23T15:00:00Z"));
    expect(iso(r.ultima)).toBe("2026-11-23T11:00:00.000Z");
    expect(iso(r.proxima)).toBe("2026-11-24T11:00:00.000Z");
    const antes = ultimaEProxima(todoDia, new Date("2026-11-24T11:00:00Z"), new Date("2026-11-23T15:00:00Z"));
    expect(antes.ultima).toBeNull();
  });
});
