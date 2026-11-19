/**
 * A documentação da API (docs/api/README.md) precisa estar igual à gerada pelos contratos.
 * Se este teste falhar: rode pnpm api:documentar e inclua o arquivo no mesmo PR.
 */
import { readFileSync } from "node:fs";
import { ARQUIVO_API, documentacaoDaApi, ROTAS } from "@mago-os/nucleo/documentar-api";
import { describe, expect, it } from "vitest";

describe("documentação da API", () => {
  it("docs/api/README.md está atualizado (senão: pnpm api:documentar)", () => {
    expect(readFileSync(ARQUIVO_API, "utf8")).toBe(documentacaoDaApi());
  });

  it("a tabela de rotas é igual às rotas registradas no código (tarefas, agentes, avisos e MCP)", () => {
    const arquivos = ["tarefas/rotas.ts", "agentes/rotas.ts", "avisos/index.ts", "mcp/index.ts"];
    const noCodigo = new Set<string>();
    for (const a of arquivos) {
      const texto = readFileSync(new URL(`../../nucleo/src/${a}`, import.meta.url), "utf8");
      for (const m of texto.matchAll(/app\.(get|post|delete)\(\s*"([^"]+)"/g))
        noCodigo.add(`${m[1]?.toUpperCase()} ${m[2]}`);
      for (const m of texto.matchAll(/rotaDeSituacao\(\s*"([^"]+)"/g)) noCodigo.add(`POST ${m[1]}`);
    }
    // GET e DELETE /mcp só respondem 405 (sem sessão no servidor).
    noCodigo.delete("GET /mcp");
    noCodigo.delete("DELETE /mcp");
    expect([...noCodigo].sort()).toEqual(ROTAS.map((r) => `${r.metodo} ${r.caminho}`).sort());
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
