import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarDesafio, desafioValido, politicaDoQuadro, provaValida } from "./balao.ts";
import { paginaSemDados } from "./servico.ts";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const CANAL = "01900000-0000-7000-8000-000000000001";

describe("balão do site", () => {
  it("o desafio é do canal, assinado, vale depois de 2 segundos e por 10 minutos", () => {
    const agora = Date.now();
    const d = criarDesafio(SEGREDO, CANAL, agora);
    expect(desafioValido(SEGREDO, CANAL, d, agora + 1000)).toBe(false);
    expect(desafioValido(SEGREDO, CANAL, d, agora + 3000)).toBe(true);
    expect(desafioValido(SEGREDO, CANAL, d, agora + 11 * 60_000)).toBe(false);
    expect(desafioValido(SEGREDO, "01900000-0000-7000-8000-000000000002", d, agora + 3000)).toBe(false);
    expect(desafioValido("outro-segredo-com-mais-de-32-caracteres!", CANAL, d, agora + 3000)).toBe(false);
    const [corpo] = d.split(".");
    expect(desafioValido(SEGREDO, CANAL, `${corpo}.assinatura-errada`, agora + 3000)).toBe(false);
  });

  it("a prova confere os bits zerados do começo do SHA-256", () => {
    const d = "desafio";
    const zero = (n: number) => createHash("sha256").update(`${d}:${n}`).digest()[0] === 0;
    let n = 0;
    while (!zero(n)) n++;
    expect(provaValida(d, String(n), 8)).toBe(true);
    let m = n + 1;
    while (zero(m)) m++;
    expect(provaValida(d, String(m), 8)).toBe(false);
  });

  it("a página do quadro só abre nos domínios do canal", () => {
    expect(politicaDoQuadro(["https://a.com.br", "https://www.b.com"])).toContain(
      "frame-ancestors https://a.com.br https://www.b.com",
    );
  });

  it("guarda a página sem o que vem depois do ? e do #", () => {
    expect(paginaSemDados("https://loja.com.br/p/1?email=a@b.c#x")).toBe("https://loja.com.br/p/1");
    expect(paginaSemDados("javascript:alert(1)")).toBeNull();
    expect(paginaSemDados("não é endereço")).toBeNull();
  });
});
