import { describe, expect, it } from "vitest";
import { conferirPedidoDeEdicaoDeEvento, conferirPedidoDeEvento, type PedidoDeEvento } from "./eventos.ts";

const ID = "00000000-0000-7000-8000-000000000001";

const reuniao: PedidoDeEvento = {
  titulo: "Reunião com a Ana",
  inicio: { dia: "2026-11-26", hora: "15:00" },
  fim: { dia: "2026-11-26", hora: "16:00" },
  participantes: [ID],
};

describe("agenda", () => {
  it("evento com horário: começo e fim com hora, o fim depois do começo", () => {
    expect(conferirPedidoDeEvento(reuniao).ok).toBe(true);
    expect(conferirPedidoDeEvento({ ...reuniao, fim: { dia: "2026-11-26", hora: "14:00" } }).ok).toBe(false);
    expect(conferirPedidoDeEvento({ ...reuniao, fim: { dia: "2026-11-26" } }).ok).toBe(false);
    expect(conferirPedidoDeEvento({ ...reuniao, link: "http://inseguro.com" }).ok).toBe(false);
    expect(conferirPedidoDeEvento({ ...reuniao, link: "https://meet.example.com/abc" }).ok).toBe(true);
  });

  it("dia inteiro: sem hora, pode acabar no mesmo dia, até 14 dias", () => {
    const folga = { ...reuniao, diaInteiro: true, inicio: { dia: "2026-12-24" }, fim: { dia: "2026-12-24" } };
    expect(conferirPedidoDeEvento(folga).ok).toBe(true);
    expect(conferirPedidoDeEvento({ ...folga, inicio: { dia: "2026-12-24", hora: "09:00" } }).ok).toBe(false);
    expect(conferirPedidoDeEvento({ ...folga, fim: { dia: "2027-01-10" } }).ok).toBe(false);
  });

  it("alertas: até 5, de 0 a 7 dias, sem repetir; a regra segue a das tarefas", () => {
    expect(conferirPedidoDeEvento({ ...reuniao, alertas: [10, 60] }).ok).toBe(true);
    expect(conferirPedidoDeEvento({ ...reuniao, alertas: [10, 10] }).ok).toBe(false);
    expect(conferirPedidoDeEvento({ ...reuniao, alertas: [1, 2, 3, 4, 5, 6] }).ok).toBe(false);
    expect(
      conferirPedidoDeEvento({
        ...reuniao,
        regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [4] },
      }).ok,
    ).toBe(true);
    expect(
      conferirPedidoDeEvento({ ...reuniao, regra: { frequencia: "diaria", intervalo: 1, diaDoMes: 3 } }).ok,
    ).toBe(false);
  });

  it("editar numa série: só este e este e os seguintes dizem a ocorrência", () => {
    expect(conferirPedidoDeEdicaoDeEvento({ titulo: "Outro", alcance: "todos" }).ok).toBe(true);
    expect(conferirPedidoDeEdicaoDeEvento({ titulo: "Outro", alcance: "so_este" }).ok).toBe(false);
    expect(
      conferirPedidoDeEdicaoDeEvento({ titulo: "Outro", alcance: "so_este", ocorrencia: "2026-12-03" }).ok,
    ).toBe(true);
    expect(conferirPedidoDeEdicaoDeEvento({}).ok).toBe(false);
  });
});
