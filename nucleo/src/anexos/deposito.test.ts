import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  criarDepositoEmDisco,
  criarDepositoS3,
  disposicao,
  podeVerNaTela,
  regiaoDoEndpoint,
} from "./deposito.ts";

describe("depósito", () => {
  it("só imagem e PDF abrem na tela; o nome não escapa do cabeçalho", () => {
    expect(podeVerNaTela("application/pdf")).toBe(true);
    expect(podeVerNaTela("image/svg+xml")).toBe(false);
    expect(podeVerNaTela("text/html")).toBe(false);
    expect(disposicao('a"b\r\nc.pdf', "application/pdf")).toMatch(/^inline; filename="a_b__c\.pdf"/);
    expect(disposicao("página.html", "text/html")).toBe(
      `attachment; filename="p_gina.html"; filename*=UTF-8''p%C3%A1gina.html`,
    );
  });

  it("região do Backblaze pelo endpoint", () => {
    expect(regiaoDoEndpoint("https://s3.us-east-005.backblazeb2.com")).toBe("us-east-005");
    expect(regiaoDoEndpoint("http://127.0.0.1:3900")).toBe("us-east-1");
  });

  it("o link do S3 assina tipo e tamanho e expira no tempo pedido", () => {
    const agora = new Date("2026-11-19T12:00:00Z");
    const d = criarDepositoS3(
      {
        endpoint: "https://s3.us-east-005.backblazeb2.com",
        regiao: "us-east-005",
        bucket: "b",
        chaveId: "id",
        chaveSegredo: "s",
      },
      () => agora,
    );
    const l = d.linkDeEnvio("quarentena/e/x", "application/pdf", 10, 300);
    expect(l.url).toContain("/b/quarentena/e/x?");
    expect(l.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(l.url).toContain("X-Amz-Expires=300");
    expect(l.expiraEm.toISOString()).toBe("2026-11-19T12:05:00.000Z");
  });

  it("no disco, o link adulterado ou vencido não vale", async () => {
    let agora = new Date();
    const d = criarDepositoEmDisco("http://localhost", await mkdtemp(join(tmpdir(), "dep-")), () => agora);
    const token = d.linkDeEnvio("a/b", "text/plain", 3, 300).url.split("?t=")[1] as string;
    expect(d.conferirLink(token)).toMatchObject({ metodo: "PUT", caminho: "a/b", tamanho: 3 });
    expect(d.conferirLink(`${token.slice(0, -2)}xx`)).toBeNull();
    agora = new Date(agora.getTime() + 301_000);
    expect(d.conferirLink(token)).toBeNull();
    await expect(d.gravar("../fora", Buffer.from("x"), "text/plain")).rejects.toThrow(/fora do depósito/);
  });
});
