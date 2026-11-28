/**
 * Os cabeçalhos de segurança da tela (M6-04) são os mesmos no Caddy (teste e produção) e na prévia onde rodam os
 * testes de tela. Mudou um, muda o outro.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CABECALHOS_DE_SEGURANCA, POLITICA_DE_CONTEUDO } from "../../telas/cabecalhos-de-seguranca.ts";

const caddys = {
  teste: readFileSync(new URL("../../infra/vps02/caddy/mago-os.caddy.modelo", import.meta.url), "utf8"),
  producao: readFileSync(
    new URL("../../infra/producao/caddy/mago-os-producao.caddy.modelo", import.meta.url),
    "utf8",
  ),
};

describe("cabeçalhos de segurança (M6-04)", () => {
  it("o Caddy do teste e o da produção mandam exatamente os mesmos cabeçalhos da prévia dos testes de tela", () => {
    for (const [ambiente, caddy] of Object.entries(caddys)) {
      for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
        const linha = caddy.split("\n").find((l) => l.trim().startsWith(`${nome} `));
        expect(linha, `falta ${nome} no Caddy (${ambiente})`).toBeTruthy();
        expect(
          linha
            ?.trim()
            .slice(nome.length + 1)
            .replace(/^"|"$/g, ""),
        ).toBe(valor);
      }
      expect(caddy).toContain("Strict-Transport-Security");
    }
  });

  it("só o balão do site (M8-07) fica de fora do frame-ancestors 'none', pela API, nos domínios do canal", () => {
    for (const [ambiente, caddy] of Object.entries(caddys)) {
      expect(caddy, ambiente).toContain("@nao_e_o_balao not path /balao.js /balao/*");
      expect(caddy, ambiente).toMatch(
        /header @nao_e_o_balao \{[^}]*Content-Security-Policy[^}]*X-Frame-Options DENY/,
      );
      expect(caddy, ambiente).toMatch(/handle \/balao\/\* \{\s*import mago_os_[a-z_]*api/);
    }
  });

  it("a produção só aceita pedidos da Cloudflare (e do próprio servidor), antes de qualquer resposta", () => {
    const p = caddys.producao;
    expect(p).toMatch(/@fora_da_cloudflare not remote_ip [^\n]*127\.0\.0\.1\/8/);
    expect(p).toMatch(/route \{\s*abort @fora_da_cloudflare/);
  });

  it("a política não deixa script escrito na página nem de fora, e o site não abre dentro de outro", () => {
    const script = POLITICA_DE_CONTEUDO.split("; ").find((p) => p.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(POLITICA_DE_CONTEUDO).toContain("frame-ancestors 'none'");
    expect(POLITICA_DE_CONTEUDO).toContain("object-src 'none'");
    const html = readFileSync(new URL("../../telas/index.html", import.meta.url), "utf8");
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [], "script escrito no index.html").toEqual([]);
  });
});
