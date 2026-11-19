import { describe, expect, it } from "vitest";
import { diferencaEmDias, proximoDia } from "./recorrencia.ts";

describe("recorrência", () => {
  it("diária e a cada N dias, atravessando a virada do mês e do ano", () => {
    expect(proximoDia({ frequencia: "diaria", intervalo: 1 }, "2026-11-30", 1)).toBe("2026-12-01");
    expect(proximoDia({ frequencia: "diaria", intervalo: 3 }, "2026-12-30", 1)).toBe("2027-01-02");
  });

  it("semanal: toda segunda; segunda e quinta; a cada duas semanas", () => {
    // 23/11/2026 é segunda-feira.
    expect(proximoDia({ frequencia: "semanal", intervalo: 1 }, "2026-11-23", 1)).toBe("2026-11-30");
    const segEQui = { frequencia: "semanal" as const, intervalo: 1, diasDaSemana: [1, 4] };
    expect(proximoDia(segEQui, "2026-11-23", 1)).toBe("2026-11-26");
    expect(proximoDia(segEQui, "2026-11-26", 2)).toBe("2026-11-30");
    expect(proximoDia({ frequencia: "semanal", intervalo: 2, diasDaSemana: [1] }, "2026-11-23", 1)).toBe(
      "2026-12-07",
    );
  });

  it("mensal: dia 31 cai no último dia dos meses curtos e volta ao 31 depois", () => {
    const regra = { frequencia: "mensal" as const, intervalo: 1, diaDoMes: 31 };
    expect(proximoDia(regra, "2027-01-31", 1)).toBe("2027-02-28");
    expect(proximoDia(regra, "2027-02-28", 2)).toBe("2027-03-31");
    expect(proximoDia(regra, "2028-01-31", 1)).toBe("2028-02-29");
    // Sem dia do mês, vale o do prazo da primeira vez.
    expect(proximoDia({ frequencia: "mensal", intervalo: 1 }, "2027-02-28", 2, "2027-01-31")).toBe(
      "2027-03-31",
    );
    expect(proximoDia({ frequencia: "mensal", intervalo: 3 }, "2026-11-15", 1)).toBe("2027-02-15");
  });

  it("anual, com 29 de fevereiro", () => {
    expect(proximoDia({ frequencia: "anual", intervalo: 1 }, "2028-02-29", 1)).toBe("2029-02-28");
    expect(proximoDia({ frequencia: "anual", intervalo: 1 }, "2029-02-28", 2, "2028-02-29")).toBe(
      "2030-02-28",
    );
    expect(proximoDia({ frequencia: "anual", intervalo: 4 }, "2029-02-28", 2, "2028-02-29")).toBe(
      "2033-02-28",
    );
  });

  it("para depois do dia final ou das vezes", () => {
    expect(proximoDia({ frequencia: "diaria", intervalo: 1, ate: "2026-11-24" }, "2026-11-24", 1)).toBeNull();
    expect(proximoDia({ frequencia: "diaria", intervalo: 1, ate: "2026-11-25" }, "2026-11-24", 1)).toBe(
      "2026-11-25",
    );
    expect(proximoDia({ frequencia: "diaria", intervalo: 1, vezes: 3 }, "2026-11-24", 3)).toBeNull();
    expect(proximoDia({ frequencia: "diaria", intervalo: 1, vezes: 3 }, "2026-11-24", 2)).toBe("2026-11-25");
  });

  it("diferença em dias (para o início andar junto com o prazo)", () => {
    expect(diferencaEmDias("2026-11-23", "2026-11-30")).toBe(7);
    // Mudança de horário de verão não muda a conta de dias.
    expect(diferencaEmDias("2026-03-28", "2026-03-30")).toBe(2);
  });
});
