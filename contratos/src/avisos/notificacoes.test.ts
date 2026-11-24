import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  canaisDoTipo,
  horaDoResumo,
  PedidoDeAssinaturaDePush,
  PreferenciasDeNotificacao,
} from "./notificacoes.ts";

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

describe("avisos pelo Telegram (M5-08)", () => {
  const sem = { porTipo: {}, silencio: null };
  it("por padrão, só o urgente vai pelo Telegram; o pedido de aprovação nunca (já vai com os botões)", () => {
    expect(canaisDoTipo(sem, "mencao")).toEqual({ tela: true, push: true, telegram: true });
    expect(canaisDoTipo(sem, "comentario")).toEqual({ tela: true, push: true, telegram: false });
    expect(canaisDoTipo(sem, "aprovacao_pedida").telegram).toBe(false);
    expect(canaisDoTipo(sem, "rotina_rodou").telegram).toBe(true);
    expect(canaisDoTipo(sem, "tarefa_atribuida").telegram).toBe(false);
    expect(
      canaisDoTipo(
        { porTipo: { aprovacao_pedida: { tela: true, push: true, telegram: true } }, silencio: null },
        "aprovacao_pedida",
      ).telegram,
    ).toBe(false);
    expect(
      canaisDoTipo(
        { porTipo: { comentario: { tela: true, push: false, telegram: true } }, silencio: null },
        "comentario",
      ),
    ).toEqual({ tela: true, push: false, telegram: true });
  });

  it("quem desligou o sino e o push de um tipo antes do Telegram não recebe por ele", () => {
    expect(
      canaisDoTipo({ porTipo: { mencao: { tela: false, push: false } }, silencio: null }, "mencao").telegram,
    ).toBe(false);
  });

  it("o resumo do dia: ligado às 8h por padrão, na hora escolhida, ou desligado", () => {
    expect(horaDoResumo(sem)).toBe("08:00");
    expect(horaDoResumo({ ...sem, resumoDoDia: { hora: "07:30" } })).toBe("07:30");
    expect(horaDoResumo({ ...sem, resumoDoDia: null })).toBeNull();
    expect(conferir(PreferenciasDeNotificacao, { ...sem, resumoDoDia: { hora: "25:00" } }).ok).toBe(false);
  });
});
