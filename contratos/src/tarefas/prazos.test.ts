import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { conferirRegraDeRecorrencia, PedidoDePlanejamento, PedidoDePrazo } from "./prazos.ts";

describe("prazo e recorrência", () => {
  it("prazo com ou sem hora, e hora fora do formato é recusada", () => {
    expect(conferir(PedidoDePrazo, { dia: "2026-11-23" }).ok).toBe(true);
    expect(conferir(PedidoDePrazo, { dia: "2026-11-23", hora: "09:00", fuso: "Europe/Lisbon" }).ok).toBe(
      true,
    );
    expect(conferir(PedidoDePrazo, { dia: "2026-11-23", hora: "9h" }).ok).toBe(false);
    expect(conferir(PedidoDePrazo, { dia: "2026-11-23", hora: "24:00" }).ok).toBe(false);
  });

  it("dias da semana só na semanal, dia do mês só na mensal", () => {
    expect(conferirRegraDeRecorrencia({ frequencia: "semanal", intervalo: 1, diasDaSemana: [1, 4] }).ok).toBe(
      true,
    );
    expect(conferirRegraDeRecorrencia({ frequencia: "mensal", intervalo: 1, diaDoMes: 31 }).ok).toBe(true);
    expect(conferirRegraDeRecorrencia({ frequencia: "diaria", intervalo: 1, diasDaSemana: [1] }).ok).toBe(
      false,
    );
    expect(conferirRegraDeRecorrencia({ frequencia: "semanal", intervalo: 1, diaDoMes: 3 }).ok).toBe(false);
    expect(conferirRegraDeRecorrencia({ frequencia: "anual", intervalo: 0 }).ok).toBe(false);
  });

  it("o planejamento pede pelo menos um campo", () => {
    expect(conferir(PedidoDePlanejamento, {}).ok).toBe(false);
    expect(conferir(PedidoDePlanejamento, { prioridade: "alta" }).ok).toBe(true);
    expect(conferir(PedidoDePlanejamento, { prioridade: "altissima" }).ok).toBe(false);
  });
});
