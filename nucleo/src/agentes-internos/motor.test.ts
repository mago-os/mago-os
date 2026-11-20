import { describe, expect, it } from "vitest";
import { partesDaConversa, textoDasPartes } from "./motor.ts";

describe("motor dos agentes internos", () => {
  it("a conversa começa pela pessoa e junta as mensagens seguidas do mesmo lado", () => {
    const partes = partesDaConversa([
      { autor: { tipo: "sistema" }, texto: "aviso" },
      { autor: { tipo: "pessoa" }, texto: "oi" },
      { autor: { tipo: "pessoa" }, texto: "planeja o blog" },
      { autor: { tipo: "agente" }, texto: "Feito." },
    ]);
    // O aviso do sistema conta como fala do lado da pessoa (não do agente).
    expect(partes.map((p) => p.papel)).toEqual(["usuario", "assistente"]);
    expect(partes[0]?.papel === "usuario" && partes[0].texto).toBe("aviso\n\noi\n\nplaneja o blog");
  });

  it("para o Claude Code: um pedido só vai como veio; uma conversa vira o histórico em texto", () => {
    expect(textoDasPartes([{ papel: "usuario", texto: "planeja o blog" }])).toBe("planeja o blog");
    const texto = textoDasPartes([
      { papel: "usuario", texto: "planeja o blog" },
      { papel: "assistente", texto: "Qual o prazo?", chamadas: [] },
      { papel: "usuario", texto: "sexta" },
    ]);
    expect(texto).toContain("Pessoa: planeja o blog");
    expect(texto).toContain("Você: Qual o prazo?");
    expect(texto.endsWith("Responda à última mensagem da pessoa.")).toBe(true);
  });
});
