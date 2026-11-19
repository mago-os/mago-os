/**
 * A documentação da API (docs/api/README.md) precisa estar igual à gerada pelos contratos.
 * Se este teste falhar: rode pnpm api:documentar e inclua o arquivo no mesmo PR.
 */
import { readFileSync } from "node:fs";
import { ARQUIVO_API, documentacaoDaApi } from "@mago-os/nucleo/documentar-api";
import { describe, expect, it } from "vitest";

describe("documentação da API", () => {
  it("docs/api/README.md está atualizado (senão: pnpm api:documentar)", () => {
    expect(readFileSync(ARQUIVO_API, "utf8")).toBe(documentacaoDaApi());
  });

  it("mostra as oito ferramentas do MCP", () => {
    const doc = documentacaoDaApi();
    for (const nome of [
      "minhas_tarefas",
      "ver_tarefa",
      "pegar_tarefa",
      "soltar_tarefa",
      "comentar",
      "mudar_status",
      "entregar_resultado",
      "estou_vivo",
    ]) {
      expect(doc).toContain(`### \`${nome}\``);
    }
  });
});
