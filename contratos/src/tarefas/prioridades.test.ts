import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { ItemDePrioridade, PedidoDeAdiarPrioridade, TIPOS_DE_PRIORIDADE } from "./prioridades.ts";

describe("central de prioridades", () => {
  it("tem a ordem fixa da decisão 13, com o lugar das aprovações", () => {
    expect(TIPOS_DE_PRIORIDADE).toEqual([
      "atrasada",
      "vence_hoje",
      "precisa_de_ajuda",
      "mencao",
      "aviso_de_agente",
      "aprovacao",
    ]);
  });

  it("confere o item e o pedido de adiar", () => {
    const item = {
      chave: "tarefa:0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:2026-11-20T14:00:00Z",
      tipo: "vence_hoje",
      titulo: "Conferir o relatório",
      motivo: "vence hoje às 14h",
      link: "/tarefas/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      tarefaId: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      desde: "2026-11-20T14:00:00Z",
    };
    expect(conferir(ItemDePrioridade, item).ok).toBe(true);
    expect(conferir(ItemDePrioridade, { ...item, tipo: "urgente" }).ok).toBe(false);
    expect(conferir(PedidoDeAdiarPrioridade, { chave: item.chave, ate: "2026-11-23" }).ok).toBe(true);
    expect(conferir(PedidoDeAdiarPrioridade, { chave: item.chave, ate: "amanhã" }).ok).toBe(false);
  });
});
