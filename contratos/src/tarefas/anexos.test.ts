import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { extensaoBloqueada, PedidoDeEnvioDeAnexo, TAMANHO_MAXIMO_DO_ANEXO } from "./anexos.ts";

describe("anexos", () => {
  it("aceita até 25 MB e recusa tipo malformado", () => {
    const ok = { nome: "contrato.pdf", tipo: "application/pdf", tamanho: 1024 };
    expect(conferir(PedidoDeEnvioDeAnexo, ok).ok).toBe(true);
    expect(conferir(PedidoDeEnvioDeAnexo, { ...ok, tamanho: TAMANHO_MAXIMO_DO_ANEXO + 1 }).ok).toBe(false);
    expect(conferir(PedidoDeEnvioDeAnexo, { ...ok, tamanho: 0 }).ok).toBe(false);
    expect(conferir(PedidoDeEnvioDeAnexo, { ...ok, tipo: "pdf" }).ok).toBe(false);
  });

  it("bloqueia extensões que rodam programa, sem diferença de maiúsculas", () => {
    expect(extensaoBloqueada("instalar.EXE")).toBe(true);
    expect(extensaoBloqueada("script.js")).toBe(true);
    expect(extensaoBloqueada("nota.pdf.bat")).toBe(true);
    expect(extensaoBloqueada("foto.jpg")).toBe(false);
    expect(extensaoBloqueada("sem-extensao")).toBe(false);
  });
});
