/**
 * A documentação do banco (docs/banco/README.md) precisa estar igual à gerada pelas migrações.
 * Se este teste falhar: rode pnpm banco:documentar e inclua o arquivo no mesmo PR.
 */
import { readFileSync } from "node:fs";
import { ARQUIVO_DOCUMENTACAO, documentacaoAtual } from "@mago-os/nucleo/documentar-banco";
import { describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

describe.skipIf(!bancoDisponivel)("documentação do banco", () => {
  it("docs/banco/README.md está atualizado (senão: pnpm banco:documentar)", async () => {
    expect(readFileSync(ARQUIVO_DOCUMENTACAO, "utf8")).toBe(await documentacaoAtual());
  });
});
