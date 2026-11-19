import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { PedidoDeAssinaturaDePush, PreferenciasDeNotificacao } from "./notificacoes.ts";

describe("notificações", () => {
  it("assinatura de push só com endereço https e as duas chaves", () => {
    const ok = { endpoint: "https://push.exemplo.invalid/abc", chaves: { p256dh: "x", auth: "y" } };
    expect(conferir(PedidoDeAssinaturaDePush, ok).ok).toBe(true);
    expect(
      conferir(PedidoDeAssinaturaDePush, { ...ok, endpoint: "http://push.exemplo.invalid/abc" }).ok,
    ).toBe(false);
    expect(conferir(PedidoDeAssinaturaDePush, { ...ok, chaves: { p256dh: "x" } }).ok).toBe(false);
  });

  it("preferências por tipo e horário de silêncio", () => {
    const prefs = {
      porTipo: { mencao: { tela: true, push: false } },
      silencio: { de: "22:00", ate: "07:00" },
    };
    expect(conferir(PreferenciasDeNotificacao, prefs).ok).toBe(true);
    expect(
      conferir(PreferenciasDeNotificacao, { ...prefs, porTipo: { inventado: { tela: true, push: true } } })
        .ok,
    ).toBe(false);
    expect(conferir(PreferenciasDeNotificacao, { ...prefs, silencio: { de: "22h", ate: "07:00" } }).ok).toBe(
      false,
    );
  });
});
