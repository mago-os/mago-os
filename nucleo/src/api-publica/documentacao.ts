/**
 * Documentação da API pública (M7-02, decisão 0047), gerada do contrato ROTAS_DA_API_PUBLICA: o OpenAPI 3.1
 * (/api/openapi.json, que o n8n e outras ferramentas importam) e uma página simples em português (/api/docs). Pública e
 * sem nenhum dado: só os endereços, os formatos e os exemplos.
 */
import { ErroDaApi, LIMITES_DA_API, MODULOS_DA_API, ROTAS_DA_API_PUBLICA } from "@mago-os/contratos";
import type { TSchema } from "typebox";

/** O esquema como JSON Schema puro (o TypeBox guarda símbolos que o JSON não leva). */
const puro = (esquema: TSchema): Record<string, unknown> => JSON.parse(JSON.stringify(esquema));

/** As propriedades de um objeto, para virar os parâmetros da query. */
function parametrosDaQuery(esquema: TSchema | null) {
  const props = (puro(esquema ?? ({} as TSchema)).properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return Object.entries(props).map(([nome, s]) => {
    const lista = s.type === "array";
    return {
      name: nome,
      in: "query",
      required: false,
      description:
        `${String(s.description ?? "")}${lista ? " Vários valores separados por vírgula." : ""}`.trim(),
      schema: lista ? { type: "string" } : s,
    };
  });
}

export function documentoOpenApi(urlPublica: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROTAS_DA_API_PUBLICA) {
    const operacao: Record<string, unknown> = {
      operationId: r.id,
      summary: r.resumo,
      description: `${r.descricao}\n\nEscopo da chave: ${r.modulo} (${r.precisa}).`,
      tags: [r.modulo],
      parameters: [
        ...(r.caminho.includes("{id}")
          ? [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }]
          : []),
        ...(r.metodo === "GET" ? parametrosDaQuery(r.entrada) : []),
      ],
      ...(r.metodo === "POST" && r.entrada
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: puro(r.entrada), ...(r.exemplo ? { example: r.exemplo } : {}) },
              },
            },
          }
        : {}),
      responses: {
        [r.id.startsWith("criar") ? "201" : "200"]: {
          description: "Deu certo.",
          content: { "application/json": { schema: puro(r.saida) } },
        },
        "400": { description: "Pedido fora do formato ou recusado.", content: erro() },
        "401": { description: "Chave ausente, desconhecida, revogada ou vencida.", content: erro() },
        "403": {
          description: "Fora do escopo da chave, IP não permitido ou sem permissão.",
          content: erro(),
        },
        "404": { description: "Não encontrado (ou fora do alcance da chave).", content: erro() },
        "429": { description: "Muitos pedidos por minuto (veja o cabeçalho Retry-After).", content: erro() },
      },
    };
    const caminho = r.caminho;
    paths[caminho] = { ...(paths[caminho] ?? {}), [r.metodo.toLowerCase()]: operacao };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "API do Mago OS",
      version: "1",
      description: [
        "API pública do Mago OS. Cada pedido leva a chave no cabeçalho `Authorization: Bearer mago_api_...`.",
        "A chave é criada pelo administrador em Configurações › API, age em nome de uma pessoa da empresa e nunca",
        "passa do que essa pessoa pode, nem do escopo da chave. Agentes externos podem usar a própria chave (mago_ag_),",
        "com o mesmo alcance do MCP.",
        `Limites: ${LIMITES_DA_API.pedidosPorMinutoPorChave} pedidos por minuto por chave e`,
        `${LIMITES_DA_API.pedidosPorMinutoPorEmpresa} por empresa.`,
      ].join(" "),
    },
    servers: [{ url: `${urlPublica.replace(/\/$/, "")}/api` }],
    security: [{ chave: [] }],
    tags: MODULOS_DA_API.map((m) => ({ name: m })),
    components: { securitySchemes: { chave: { type: "http", scheme: "bearer" } } },
    paths,
  };
}

function erro() {
  return { "application/json": { schema: puro(ErroDaApi) } };
}

const escapar = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A página /api/docs: HTML simples, sem script, com cada endereço, o escopo e o exemplo. */
export function paginaDaDocumentacao(urlPublica: string): string {
  const base = `${urlPublica.replace(/\/$/, "")}/api`;
  const blocos = ROTAS_DA_API_PUBLICA.map((r) => {
    const exemplo = r.exemplo
      ? r.metodo === "GET"
        ? `<p>Exemplo: <code>${escapar(`${r.caminho}?${new URLSearchParams(r.exemplo as Record<string, string>)}`)}</code></p>`
        : `<pre>${escapar(JSON.stringify(r.exemplo, null, 2))}</pre>`
      : "";
    return `<section id="${r.id}">
<h3><code>${r.metodo} ${escapar(r.caminho)}</code> ${escapar(r.resumo)}</h3>
<p>${escapar(r.descricao)}</p>
<p>Escopo da chave: <strong>${r.modulo}</strong> (${r.precisa === "ler" ? "ler" : "escrever"}).</p>
${exemplo}
</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>API do Mago OS</title></head>
<body>
<main>
<h1>API do Mago OS</h1>
<p>Endereço: <code>${escapar(base)}</code>. Formato completo (OpenAPI): <a href="${escapar(base)}/openapi.json">openapi.json</a>.</p>
<h2>Como entrar</h2>
<p>Mande a chave em cada pedido, no cabeçalho <code>Authorization: Bearer mago_api_...</code>. O administrador cria a
chave em Configurações › API e escolhe os módulos (ler ou escrever), a validade (até 1 ano), os IPs permitidos e a
pessoa em nome de quem ela age. A chave nunca passa do que essa pessoa pode.</p>
<p>Exemplo: um <code>GET ${escapar(base)}/v1/tarefas?status=a_fazer</code> com a chave no cabeçalho de autorização (tipo Bearer).</p>
<p>Limites: ${LIMITES_DA_API.pedidosPorMinutoPorChave} pedidos por minuto por chave e
${LIMITES_DA_API.pedidosPorMinutoPorEmpresa} por empresa. Passou, a resposta é 429 com o cabeçalho Retry-After.</p>
<p>Os erros vêm sempre assim: <code>{"code":"FORA_DO_ESCOPO","message":"..."}</code>.</p>
<h2>Endereços</h2>
${blocos}
</main>
</body>
</html>`;
}
