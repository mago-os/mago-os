/**
 * Documentação da API gerada a partir dos contratos (M2-05): docs/api/README.md.
 *
 * Mostra as ferramentas do MCP (nome, descrição, o que recebe e o que devolve) e as rotas de tarefas, agentes e
 * chaves, com o esquema de cada pedido. Um teste confere que o arquivo está igual ao gerado: mudou um contrato,
 * rode `pnpm api:documentar` e inclua o arquivo no mesmo PR.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FERRAMENTAS_MCP,
  FiltroDeTarefas,
  PedidoDeAgente,
  PedidoDeChave,
  PedidoDeComentario,
  PedidoDeDestravar,
  PedidoDeEditarAgente,
  PedidoDeMudarStatus,
  PedidoDeTarefa,
  PedidoDeTrocarResponsavel,
} from "@mago-os/contratos";
import type { TSchema } from "typebox";

export const ARQUIVO_API = fileURLToPath(new URL("../../docs/api/README.md", import.meta.url));

interface Rota {
  metodo: "GET" | "POST" | "DELETE";
  caminho: string;
  permissao: string;
  oQueFaz: string;
  recebe?: TSchema;
}

/** As rotas de dados do M2 (a tela usa; o prefixo /api vem do Caddy). */
export const ROTAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/tarefas",
    permissao: "tarefas.ver",
    oQueFaz: "Lista as tarefas que a pessoa alcança (query: minhas=1, status=a,b).",
    recebe: FiltroDeTarefas,
  },
  {
    metodo: "POST",
    caminho: "/tarefas",
    permissao: "tarefas.criar",
    oQueFaz: "Cria uma tarefa. Sem responsável, fica com quem criou.",
    recebe: PedidoDeTarefa,
  },
  {
    metodo: "GET",
    caminho: "/tarefas/:id",
    permissao: "tarefas.ver",
    oQueFaz: "Mostra a tarefa com os comentários e os nomes citados.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/status",
    permissao: "tarefas.editar",
    oQueFaz: "Muda o status (concluir pode trazer o resultado; em andamento é pegar).",
    recebe: PedidoDeMudarStatus,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/responsavel",
    permissao: "tarefas.editar",
    oQueFaz: "Troca o responsável (pessoa ou agente ativo).",
    recebe: PedidoDeTrocarResponsavel,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/comentarios",
    permissao: "tarefas.ver",
    oQueFaz: "Comenta (mesmo travada por outro).",
    recebe: PedidoDeComentario,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/pegar",
    permissao: "tarefas.editar",
    oQueFaz: "Pega a tarefa: em andamento e travada para quem pegou.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/soltar",
    permissao: "tarefas.editar",
    oQueFaz: "Solta a tarefa que pegou: volta para A fazer.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/destravar",
    permissao: "tarefas.aprovar",
    oQueFaz: "Tira a trava de outro, com motivo.",
    recebe: PedidoDeDestravar,
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id",
    permissao: "tarefas.excluir",
    oQueFaz: "Exclui a tarefa e os comentários (não se estiver com outro).",
  },
  {
    metodo: "GET",
    caminho: "/agentes",
    permissao: "agentes.ver",
    oQueFaz: "Lista os agentes, com responsável, tarefas abertas e último sinal.",
  },
  { metodo: "GET", caminho: "/agentes/:id", permissao: "agentes.ver", oQueFaz: "Mostra um agente." },
  {
    metodo: "POST",
    caminho: "/agentes",
    permissao: "agentes.criar",
    oQueFaz: "Cadastra um agente externo.",
    recebe: PedidoDeAgente,
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id",
    permissao: "agentes.editar",
    oQueFaz: "Edita o cadastro do agente.",
    recebe: PedidoDeEditarAgente,
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/pausar",
    permissao: "agentes.editar",
    oQueFaz: "Pausa (não recebe tarefa nova; as chaves ficam).",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/retomar",
    permissao: "agentes.editar",
    oQueFaz: "Retoma o agente pausado.",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/desligar",
    permissao: "agentes.excluir",
    oQueFaz: "Desliga na hora: as tarefas voltam e o responsável é avisado.",
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/chaves",
    permissao: "agentes.editar",
    oQueFaz: "Lista as chaves (só o começo de cada uma).",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/chaves",
    permissao: "agentes.editar",
    oQueFaz: "Cria uma chave; a chave inteira vem só nesta resposta.",
    recebe: PedidoDeChave,
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/chaves/:chaveId/revogar",
    permissao: "agentes.editar",
    oQueFaz: "Revoga a chave (vale no pedido seguinte).",
  },
  {
    metodo: "GET",
    caminho: "/avisos",
    permissao: "agentes.ver",
    oQueFaz: "Avisos não lidos da própria pessoa.",
  },
  {
    metodo: "POST",
    caminho: "/avisos/:id/lido",
    permissao: "agentes.ver",
    oQueFaz: "Marca o aviso como lido.",
  },
  {
    metodo: "POST",
    caminho: "/agente/estou-vivo",
    permissao: "chave do agente",
    oQueFaz: "Sinal de vida do agente (Authorization: Bearer mago_ag_...).",
  },
  {
    metodo: "POST",
    caminho: "/mcp",
    permissao: "chave do agente",
    oQueFaz: "Servidor MCP (transporte HTTP, sem sessão). Ferramentas abaixo.",
  },
];

/** Resume um esquema JSON em linhas "campo (tipo, obrigatório): descrição". */
function campos(esquema: TSchema): string[] {
  const e = esquema as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  const props = e.properties ?? {};
  const obrigatorios = new Set(e.required ?? []);
  const linhas = Object.entries(props).map(([nome, p]) => {
    const tipo = tipoDe(p);
    const desc = typeof p.description === "string" ? `: ${p.description}` : "";
    return `- \`${nome}\` (${tipo}${obrigatorios.has(nome) ? ", obrigatório" : ""})${desc}`;
  });
  return linhas.length > 0 ? linhas : ["- (nada)"];
}

function tipoDe(p: Record<string, unknown>): string {
  if (Array.isArray(p.enum)) return p.enum.map((v) => `"${String(v)}"`).join(" | ");
  if (Array.isArray(p.anyOf)) return p.anyOf.map((x) => tipoDe(x as Record<string, unknown>)).join(" ou ");
  if (p.type === "array") return `lista de ${tipoDe((p.items ?? {}) as Record<string, unknown>)}`;
  if (p.format === "uuid") return "id";
  if (p.format === "date-time") return "data e hora";
  if (p.const !== undefined) return JSON.stringify(p.const);
  if (p.type === "object" || p.type === undefined) return "objeto";
  return String(p.type);
}

export function documentacaoDaApi(): string {
  const partes: string[] = [
    "# API do Mago OS",
    "",
    "> Gerado por `pnpm api:documentar` a partir dos contratos (`@mago-os/contratos`). Não edite à mão: mude o contrato e gere de novo. O teste `testes/src/documentacao-api.test.ts` confere que está em dia.",
    "",
    "## Servidor MCP",
    "",
    "Endereço: `https://teste.osmago.com/mcp` (transporte HTTP do MCP, sem sessão). Cabeçalho: `Authorization: Bearer mago_ag_...` (a chave criada na página do agente). O agente só alcança as tarefas atribuídas a ele ou que pegou, da empresa dele. Ver a [decisão 0019](../decisoes/0019-servidor-mcp.md).",
    "",
  ];
  for (const f of FERRAMENTAS_MCP) {
    partes.push(
      `### \`${f.nome}\``,
      "",
      f.descricao,
      "",
      "Recebe:",
      "",
      ...campos(f.entrada),
      "",
      "Devolve:",
      "",
      ...campos(f.saida),
      "",
    );
  }
  partes.push(
    "## Rotas",
    "",
    "Todas com o prefixo `/api` no site. As rotas da tela pedem a sessão da pessoa e passam pela verificação central de permissões.",
    "",
  );
  partes.push("| Método | Caminho | Permissão | O que faz |", "| --- | --- | --- | --- |");
  for (const r of ROTAS) partes.push(`| ${r.metodo} | \`${r.caminho}\` | ${r.permissao} | ${r.oQueFaz} |`);
  partes.push("");
  for (const r of ROTAS.filter((x) => x.recebe)) {
    partes.push(`### ${r.metodo} \`${r.caminho}\``, "", "Recebe:", "", ...campos(r.recebe as TSchema), "");
  }
  return `${partes.join("\n").trimEnd()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(ARQUIVO_API, documentacaoDaApi());
  console.log(`Documentação da API gerada em ${ARQUIVO_API}`);
}
