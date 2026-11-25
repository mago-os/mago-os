import { describe, expect, it } from "vitest";
import politica from "../textos/politica-de-privacidade.md?raw";
import { lerTexto, lerTrechos } from "./texto-simples.ts";

describe("lerTrechos", () => {
  it("separa negrito e links https", () => {
    expect(lerTrechos("um **dois** e [três](https://exemplo.com/a) fim")).toEqual([
      { tipo: "texto", texto: "um " },
      { tipo: "negrito", texto: "dois" },
      { tipo: "texto", texto: " e " },
      { tipo: "link", texto: "três", endereco: "https://exemplo.com/a" },
      { tipo: "texto", texto: " fim" },
    ]);
  });

  it("não vira link o que não é https", () => {
    expect(lerTrechos("[x](javascript:alert(1))")).toEqual([
      { tipo: "texto", texto: "[x](javascript:alert(1))" },
    ]);
  });
});

describe("lerTexto", () => {
  it("lê títulos, parágrafos de várias linhas, listas e tabelas, sem os comentários", () => {
    const blocos = lerTexto(
      [
        "<!-- nota interna -->",
        "# Título",
        "",
        "Primeira linha",
        "segunda linha.",
        "",
        "- item um",
        "  continua",
        "- item **dois**",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "## Seção",
      ].join("\n"),
    );
    expect(blocos.map((b) => b.tipo)).toEqual(["titulo", "paragrafo", "lista", "tabela", "titulo"]);
    expect(blocos[1]).toEqual({
      tipo: "paragrafo",
      trechos: [{ tipo: "texto", texto: "Primeira linha segunda linha." }],
    });
    expect(blocos[2]).toMatchObject({
      itens: [[{ texto: "item um continua" }], [{}, { tipo: "negrito", texto: "dois" }]],
    });
    expect(blocos[3]).toMatchObject({
      cabecalho: [[{ texto: "A" }], [{ texto: "B" }]],
      linhas: [[[{ texto: "1" }], [{ texto: "2" }]]],
    });
    expect(JSON.stringify(blocos)).not.toContain("nota interna");
  });

  it("a política de privacidade não tem dado faltando nem travessão, e tem as 14 seções", () => {
    const blocos = lerTexto(politica);
    const titulos = blocos.filter((b) => b.tipo === "titulo");
    expect(titulos[0]).toEqual({ tipo: "titulo", nivel: 1, texto: "Política de Privacidade do Mago OS" });
    expect(titulos.filter((t) => t.tipo === "titulo" && t.nivel === 2)).toHaveLength(14);
    const visivel = JSON.stringify(blocos);
    expect(visivel).not.toMatch(/\[[A-ZÇÃÉ ]{4,}\]/);
    expect(visivel).not.toContain("—");
    expect(visivel).toContain("privacidade@osmago.com");
  });
});
