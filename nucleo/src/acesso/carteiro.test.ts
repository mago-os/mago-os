import { describe, expect, it } from "vitest";
import { carteiroResend, emailDeConvite, REMETENTE } from "./carteiro.ts";

describe("carteiro do Resend", () => {
  it("manda o convite pelo Resend, do remetente do Mago OS, com o link", async () => {
    const pedidos: { url: string; corpo: Record<string, unknown>; chave: string }[] = [];
    const envio = (async (url: string, init: RequestInit) => {
      pedidos.push({
        url,
        corpo: JSON.parse(String(init.body)),
        chave: String((init.headers as Record<string, string>).Authorization),
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const carteiro = carteiroResend("re_teste", envio);
    await carteiro.enviarConvite?.({
      para: "nina@teste.invalid",
      nome: "Nina",
      empresa: "Empresa <Um>",
      quemConvidou: "Ana",
      link: "https://teste.osmago.invalid/convite?codigo=abc",
    });
    expect(pedidos[0]?.url).toBe("https://api.resend.com/emails");
    expect(pedidos[0]?.chave).toBe("Bearer re_teste");
    expect(pedidos[0]?.corpo).toMatchObject({ from: REMETENTE, to: ["nina@teste.invalid"] });
    expect(String(pedidos[0]?.corpo.html)).toContain("Empresa &lt;Um&gt;");
    expect(String(pedidos[0]?.corpo.text)).toContain("https://teste.osmago.invalid/convite?codigo=abc");
  });

  it("erro do Resend vira exceção", async () => {
    const envio = (async () => new Response("nao", { status: 422 })) as unknown as typeof fetch;
    await expect(
      carteiroResend("re_teste", envio).enviarLinkDeSenha({
        para: "a@b.invalid",
        nome: "A",
        link: "https://x",
      }),
    ).rejects.toThrow(/422/);
  });

  it("os textos não usam o travessão", () => {
    const e = emailDeConvite({ para: "a", nome: "A", empresa: "E", quemConvidou: "Q", link: "https://x" });
    expect(`${e.assunto}${e.html}${e.text}`).not.toContain("—");
  });
});
