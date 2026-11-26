import { describe, expect, it } from "vitest";
import { conferirPedidoDeWebhook, ESPERAS_DAS_TENTATIVAS } from "./webhooks.ts";

describe("webhooks", () => {
  it("aceita https público e recusa http, usuário no endereço e rede interna", () => {
    const ok = (url: string) =>
      conferirPedidoDeWebhook({ nome: "n8n", url, eventos: ["tarefa.concluida"] }).ok;
    expect(ok("https://n8n.exemplo.com.br/webhook/mago")).toBe(true);
    expect(ok("http://n8n.exemplo.com.br/webhook")).toBe(false);
    expect(ok("https://usuario:senha@n8n.exemplo.com.br/")).toBe(false);
    expect(ok("https://localhost/x")).toBe(false);
    expect(ok("https://10.0.0.5/x")).toBe(false);
    expect(ok("https://192.168.1.10/x")).toBe(false);
    expect(ok("https://172.20.0.1/x")).toBe(false);
    expect(ok("https://169.254.169.254/latest")).toBe(false);
  });

  it("pede pelo menos um evento conhecido", () => {
    expect(conferirPedidoDeWebhook({ nome: "n8n", url: "https://a.com/x", eventos: [] }).ok).toBe(false);
    expect(
      conferirPedidoDeWebhook({ nome: "n8n", url: "https://a.com/x", eventos: ["tarefa.apagada"] }).ok,
    ).toBe(false);
  });

  it("as novas tentativas somam menos de 24 horas", () => {
    expect(ESPERAS_DAS_TENTATIVAS.reduce((a, b) => a + b, 0)).toBeLessThan(24 * 60);
  });
});
