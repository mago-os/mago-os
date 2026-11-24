import { describe, expect, it } from "vitest";
import { enderecoSemValores, limparRegistro, limparTexto } from "./registros.ts";

describe("filtro dos registros (M6-02)", () => {
  it("apaga e-mail, chave do agente, chave de IA, credencial e token do Telegram de qualquer texto", () => {
    const texto = limparTexto(
      "ana@teste.com.br usou mago_ag_abcdefghij_XyZ123-_abc e sk-ant-api03-chave-muito-longa-Ab1 com Bearer abcdefgh12345 e 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0",
    );
    expect(texto).toBe("[e-mail] usou [chave] e [chave] com [credencial] e [token]");
  });

  it("tira os campos de texto livre e os segredos, em qualquer nível, sem mudar o original", () => {
    const original = {
      evento: "tarefa.criou",
      tarefaId: "01a2",
      dados: { titulo: "Contrato da DFO", texto: "segredo", email: "x@y.com", lista: [{ senha: "1" }] },
      motivo: "falhou para fulano@exemplo.com",
    };
    expect(limparRegistro(original)).toEqual({
      evento: "tarefa.criou",
      tarefaId: "01a2",
      dados: {
        titulo: "[retirado]",
        texto: "[retirado]",
        email: "[retirado]",
        lista: [{ senha: "[retirado]" }],
      },
      motivo: "falhou para [e-mail]",
    });
    expect(original.dados.titulo).toBe("Contrato da DFO");
  });

  it("o erro vira tipo, mensagem e pilha, sem o e-mail que estava na mensagem", () => {
    const erro = Object.assign(new Error("convite para bia@teste.com falhou"), { code: "ECONNRESET" });
    const limpo = limparRegistro({ erro }) as { erro: Record<string, string> };
    expect(limpo.erro.tipo).toBe("Error");
    expect(limpo.erro.mensagem).toBe("convite para [e-mail] falhou");
    expect(limpo.erro.codigo).toBe("ECONNRESET");
    expect(limpo.erro.pilha).not.toContain("bia@teste.com");
  });

  it("o endereço vai sem os valores da consulta (a busca pode ter texto de tarefa)", () => {
    expect(enderecoSemValores("/busca?texto=contrato%20secreto&tipo=tarefas")).toBe("/busca?texto=…&tipo=…");
    expect(enderecoSemValores("/tarefas/01a2")).toBe("/tarefas/01a2");
    expect(enderecoSemValores(undefined)).toBe("");
  });
});
