import { describe, expect, it } from "vitest";
import {
  type ParteDaConversa,
  partesParaAnthropic,
  partesParaOpenAi,
  partesParaRespostas,
  respostaDoFluxo,
} from "./conversa.ts";

const partes: ParteDaConversa[] = [
  { papel: "usuario", texto: "planeja o blog" },
  {
    papel: "assistente",
    texto: "Vou criar.",
    chamadas: [
      { id: "a", nome: "criar_tarefa", entrada: { titulo: "Blog" } },
      { id: "b", nome: "perguntar", entrada: { pergunta: "Prazo?" } },
    ],
  },
  { papel: "resultado", chamadaId: "a", conteudo: '{"ok":true}', erro: false },
  { papel: "resultado", chamadaId: "b", conteudo: "recusado", erro: true },
];

describe("conversa com o modelo", () => {
  it("Anthropic: resultados seguidos vão numa mensagem só do usuário", () => {
    const m = partesParaAnthropic(partes);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[1]?.content).toHaveLength(3);
    expect(m[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "a", content: '{"ok":true}', is_error: false },
      { type: "tool_result", tool_use_id: "b", content: "recusado", is_error: true },
    ]);
  });

  it("OpenAI: sistema primeiro, chamadas com argumentos em texto e um resultado por ferramenta", () => {
    const m = partesParaOpenAi("Você é o coordenador.", partes) as { role: string; tool_calls?: unknown[] }[];
    expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(m[2]?.tool_calls).toEqual([
      { id: "a", type: "function", function: { name: "criar_tarefa", arguments: '{"titulo":"Blog"}' } },
      { id: "b", type: "function", function: { name: "perguntar", arguments: '{"pergunta":"Prazo?"}' } },
    ]);
  });

  it("Respostas (Codex): itens de chamada e de resultado, e a resposta final do fluxo", async () => {
    const itens = partesParaRespostas(partes);
    expect(itens.map((i) => i.type ?? i.role)).toEqual([
      "user",
      "assistant",
      "function_call",
      "function_call",
      "function_call_output",
      "function_call_output",
    ]);
    const fluxo = [
      'data: {"type":"response.created"}',
      "",
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Oi"}]}]}}',
      "data: [DONE]",
    ].join("\n");
    expect(await respostaDoFluxo(fluxo)).toEqual({
      output: [{ type: "message", content: [{ type: "output_text", text: "Oi" }] }],
    });
  });
});
