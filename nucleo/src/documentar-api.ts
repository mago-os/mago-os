/**
 * Documentação da API gerada a partir dos contratos (M2-05): docs/api/README.md.
 *
 * Mostra as ferramentas do MCP (nome, descrição, o que recebe e o que devolve) e as rotas de tarefas, projetos,
 * agentes e chaves, com o esquema de cada pedido. Um teste confere que o arquivo está igual ao gerado: mudou um contrato,
 * rode `pnpm api:documentar` e inclua o arquivo no mesmo PR.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FERRAMENTAS_MCP,
  FiltroDeTarefas,
  PedidoDeAgente,
  PedidoDeAssinaturaDePush,
  PedidoDeChave,
  PedidoDeComentario,
  PedidoDeDestravar,
  PedidoDeEditarAgente,
  PedidoDeEditarComentario,
  PedidoDeEditarEspaco,
  PedidoDeEditarItemDeChecklist,
  PedidoDeEditarLista,
  PedidoDeEditarProjeto,
  PedidoDeEspaco,
  PedidoDeEtiqueta,
  PedidoDeItemDeChecklist,
  PedidoDeLista,
  PedidoDeMudarLista,
  PedidoDeMudarProjeto,
  PedidoDeMudarStatus,
  PedidoDePlanejamento,
  PedidoDeProjeto,
  PedidoDeStatusDoProjeto,
  PedidoDeTarefa,
  PedidoDeTrocarResponsavel,
  PedidoDeVisaoSalva,
  PreferenciasDeNotificacao,
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

/** As rotas de dados do M2 e do M3 (a tela usa; o prefixo /api vem do Caddy). */
export const ROTAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/tarefas",
    permissao: "tarefas.ver",
    oQueFaz:
      "Lista as tarefas que a pessoa alcança (query: minhas=1, status=a,b, projeto=<id>|sem, espaco, responsaveis=p:<id>,a:<id>, agente=1, prioridades, etiquetas, prazo=atrasadas|hoje|semana|sem_prazo, de, ate, subtarefas=0).",
    recebe: FiltroDeTarefas,
  },
  {
    metodo: "POST",
    caminho: "/tarefas",
    permissao: "tarefas.criar",
    oQueFaz:
      "Cria uma tarefa, com ou sem projeto. Sem responsável, fica com quem criou; responsável nulo num projeto vai para o gerente, se o diretor quis.",
    recebe: PedidoDeTarefa,
  },
  {
    metodo: "GET",
    caminho: "/tarefas/:id",
    permissao: "tarefas.ver",
    oQueFaz:
      "Mostra a tarefa com a linha do tempo (comentários, notas internas e acontecimentos), as subtarefas, o checklist, os status do projeto e os nomes citados.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/status",
    permissao: "tarefas.editar",
    oQueFaz:
      "Muda o status (concluir pode trazer o resultado; em andamento é pegar). Concluir uma recorrente cria a próxima.",
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
    oQueFaz: "Comenta ou escreve uma nota interna (mesmo travada por outro), com menções com @.",
    recebe: PedidoDeComentario,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/comentarios/:comentarioId",
    permissao: "tarefas.ver",
    oQueFaz: "Edita o próprio comentário em até 15 minutos.",
    recebe: PedidoDeEditarComentario,
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id/comentarios/:comentarioId",
    permissao: "tarefas.ver",
    oQueFaz: 'Apaga o comentário (quem escreveu, ou quem exclui qualquer tarefa); fica "comentário apagado".',
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
    metodo: "POST",
    caminho: "/tarefas/:id/projeto",
    permissao: "tarefas.editar",
    oQueFaz: "Muda a tarefa de projeto (um projeto ativo que a pessoa alcança) ou tira do projeto (nulo).",
    recebe: PedidoDeMudarProjeto,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/planejamento",
    permissao: "tarefas.editar",
    oQueFaz:
      "Muda prioridade, prazo (dia, hora e fuso), início, etiquetas e recorrência; só o que veio muda, nulo apaga.",
    recebe: PedidoDePlanejamento,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/seguir",
    permissao: "tarefas.ver",
    oQueFaz: "Passa a seguir a tarefa (recebe aviso dos comentários).",
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id/seguir",
    permissao: "tarefas.ver",
    oQueFaz: "Deixa de seguir a tarefa.",
  },
  {
    metodo: "POST",
    caminho: "/avisos/lidos",
    permissao: "tarefas.ver",
    oQueFaz: "Marca todos os avisos da pessoa como lidos.",
  },
  {
    metodo: "GET",
    caminho: "/notificacoes",
    permissao: "tarefas.ver",
    oQueFaz: "A chave pública do push, se o push está ligado neste aparelho, e as preferências da pessoa.",
  },
  {
    metodo: "POST",
    caminho: "/notificacoes/push",
    permissao: "tarefas.ver",
    oQueFaz: "Liga o push neste aparelho (assinatura Web Push do navegador).",
    recebe: PedidoDeAssinaturaDePush,
  },
  {
    metodo: "DELETE",
    caminho: "/notificacoes/push",
    permissao: "tarefas.ver",
    oQueFaz: "Desliga o push neste aparelho.",
  },
  {
    metodo: "POST",
    caminho: "/notificacoes/preferencias",
    permissao: "tarefas.ver",
    oQueFaz: "Grava o que chega por onde (sino, push) e o horário de silêncio.",
    recebe: PreferenciasDeNotificacao,
  },
  {
    metodo: "GET",
    caminho: "/tarefas/:id/anexos",
    permissao: "tarefas.ver",
    oQueFaz: "Anexos da tarefa (os que já chegaram), com a situação do antivírus.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/anexos",
    permissao: "tarefas.editar (ou ver, no próprio comentário)",
    oQueFaz:
      "Pede o link de 5 minutos para enviar um arquivo (até 25 MB, sem tipos que rodam programa) para a quarentena.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/anexos/:anexoId/enviado",
    permissao: "tarefas.ver (quem enviou)",
    oQueFaz: "Avisa que o arquivo chegou inteiro e o manda para o antivírus.",
  },
  {
    metodo: "GET",
    caminho: "/tarefas/:id/anexos/:anexoId/link",
    permissao: "tarefas.ver",
    oQueFaz: "Link de 5 minutos para baixar ou ver um anexo liberado pelo antivírus.",
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id/anexos/:anexoId",
    permissao: "tarefas.ver (quem enviou) ou tarefas.excluir (tudo)",
    oQueFaz: "Exclui o anexo (o arquivo sai do depósito pela fila).",
  },
  {
    metodo: "GET",
    caminho: "/empresa/espaco-dos-anexos",
    permissao: "seguranca.ver",
    oQueFaz: "Quanto os anexos da empresa ocupam no depósito.",
  },
  {
    metodo: "GET",
    caminho: "/busca",
    permissao: "tarefas.ver (cada tipo pela própria permissão)",
    oQueFaz:
      "Busca Ctrl+K: tarefas, comentários, projetos, espaços, pessoas e agentes, sem acento e tolerante a erro de digitação.",
  },
  {
    metodo: "GET",
    caminho: "/layouts",
    permissao: "tarefas.ver (só os da pessoa)",
    oQueFaz: "Layouts de painéis da pessoa (do computador ou do celular), o último usado primeiro.",
  },
  {
    metodo: "POST",
    caminho: "/layouts",
    permissao: "tarefas.ver",
    oQueFaz: "Salva um layout de painéis novo (até 20 por aparelho).",
  },
  {
    metodo: "POST",
    caminho: "/layouts/:id",
    permissao: "tarefas.ver (só os da pessoa)",
    oQueFaz: "Salva por cima um layout da pessoa.",
  },
  {
    metodo: "POST",
    caminho: "/layouts/:id/usar",
    permissao: "tarefas.ver (só os da pessoa)",
    oQueFaz: "Troca para o layout (ele passa a abrir sozinho).",
  },
  {
    metodo: "DELETE",
    caminho: "/layouts/:id",
    permissao: "tarefas.ver (só os da pessoa)",
    oQueFaz: "Apaga um layout da pessoa.",
  },
  {
    metodo: "GET",
    caminho: "/empresa/dados",
    permissao: "empresa.ver",
    oQueFaz:
      "Dados da empresa (nome, nome legal, documento, telefone, fuso e idioma); CPF mascarado para quem não vê dados sensíveis.",
  },
  {
    metodo: "POST",
    caminho: "/empresa/dados",
    permissao: "empresa.editar",
    oQueFaz: "Muda os dados da empresa (mudar o documento pede o segundo fator recente).",
  },
  {
    metodo: "GET",
    caminho: "/prioridades",
    permissao: "tarefas.ver",
    oQueFaz: "Central de prioridades de quem pede, na ordem fixa (atrasadas, hoje, ajuda, menções, avisos).",
  },
  {
    metodo: "POST",
    caminho: "/prioridades/adiar",
    permissao: "tarefas.ver",
    oQueFaz: "Adia um item da central até um dia (só para quem pede).",
  },
  {
    metodo: "POST",
    caminho: "/prioridades/resolver",
    permissao: "tarefas.ver",
    oQueFaz: "Marca um item da central como resolvido (aviso de agente fica lido).",
  },
  {
    metodo: "GET",
    caminho: "/visoes",
    permissao: "tarefas.ver",
    oQueFaz: "Lista as visões salvas da pessoa (só as dela).",
  },
  {
    metodo: "POST",
    caminho: "/visoes",
    permissao: "tarefas.ver",
    oQueFaz: "Salva uma visão (nome, tipo, filtros e agrupamento).",
    recebe: PedidoDeVisaoSalva,
  },
  {
    metodo: "DELETE",
    caminho: "/visoes/:id",
    permissao: "tarefas.ver",
    oQueFaz: "Apaga uma visão da pessoa.",
  },
  {
    metodo: "GET",
    caminho: "/etiquetas",
    permissao: "tarefas.ver",
    oQueFaz: "Lista as etiquetas da empresa.",
  },
  {
    metodo: "POST",
    caminho: "/etiquetas",
    permissao: "tarefas.editar",
    oQueFaz: "Cria uma etiqueta (nome único na empresa).",
    recebe: PedidoDeEtiqueta,
  },
  {
    metodo: "DELETE",
    caminho: "/etiquetas/:id",
    permissao: "tarefas.excluir (todas)",
    oQueFaz: "Apaga a etiqueta e tira de todas as tarefas.",
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/lista",
    permissao: "tarefas.editar",
    oQueFaz: "Muda a tarefa de lista, no mesmo projeto (a subtarefa segue a mãe).",
    recebe: PedidoDeMudarLista,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/checklist",
    permissao: "tarefas.editar",
    oQueFaz: "Acrescenta um item no fim do checklist (travada, só quem pegou).",
    recebe: PedidoDeItemDeChecklist,
  },
  {
    metodo: "POST",
    caminho: "/tarefas/:id/checklist/:itemId",
    permissao: "tarefas.editar",
    oQueFaz: "Muda o texto, a posição, ou marca e desmarca um item do checklist.",
    recebe: PedidoDeEditarItemDeChecklist,
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id/checklist/:itemId",
    permissao: "tarefas.editar",
    oQueFaz: "Tira um item do checklist.",
  },
  {
    metodo: "DELETE",
    caminho: "/tarefas/:id",
    permissao: "tarefas.excluir",
    oQueFaz: "Exclui a tarefa e os comentários (não se estiver com outro).",
  },
  {
    metodo: "GET",
    caminho: "/espacos",
    permissao: "espacos.ver",
    oQueFaz: "Lista os espaços da empresa (query: arquivados=1 inclui os arquivados).",
  },
  {
    metodo: "POST",
    caminho: "/espacos",
    permissao: "espacos.criar",
    oQueFaz: "Cria um espaço.",
    recebe: PedidoDeEspaco,
  },
  {
    metodo: "POST",
    caminho: "/espacos/:id",
    permissao: "espacos.editar",
    oQueFaz: "Edita, arquiva ou desarquiva um espaço.",
    recebe: PedidoDeEditarEspaco,
  },
  {
    metodo: "GET",
    caminho: "/projetos",
    permissao: "projetos.ver",
    oQueFaz:
      "Lista os projetos que a pessoa alcança (todos, ou os que é membro), com as tarefas abertas (query: espaco=<id>, arquivados=1).",
  },
  {
    metodo: "GET",
    caminho: "/projetos/:id",
    permissao: "projetos.ver",
    oQueFaz:
      "Mostra o projeto, o espaço, as listas, os status e os nomes do diretor, do gerente e dos membros.",
  },
  {
    metodo: "POST",
    caminho: "/projetos",
    permissao: "projetos.criar",
    oQueFaz: "Cria um projeto. Sem diretor, quem cria é o diretor.",
    recebe: PedidoDeProjeto,
  },
  {
    metodo: "POST",
    caminho: "/projetos/:id",
    permissao: "projetos.editar",
    oQueFaz:
      "Edita, arquiva ou muda os membros (o diretor ou o administrador; trocar o diretor, só quem vê todos).",
    recebe: PedidoDeEditarProjeto,
  },
  {
    metodo: "POST",
    caminho: "/projetos/:id/listas",
    permissao: "projetos.editar",
    oQueFaz: "Cria uma lista no fim do projeto.",
    recebe: PedidoDeLista,
  },
  {
    metodo: "POST",
    caminho: "/listas/:id",
    permissao: "projetos.editar",
    oQueFaz: "Renomeia a lista ou muda a posição dela.",
    recebe: PedidoDeEditarLista,
  },
  {
    metodo: "DELETE",
    caminho: "/listas/:id",
    permissao: "projetos.editar",
    oQueFaz: "Exclui a lista e passa as tarefas dela para a primeira outra lista (a última não se exclui).",
  },
  {
    metodo: "POST",
    caminho: "/projetos/:id/status",
    permissao: "projetos.editar",
    oQueFaz:
      "Grava os status do projeto, todos de uma vez; os que saem passam as tarefas para o primeiro do mesmo tipo.",
    recebe: PedidoDeStatusDoProjeto,
  },
  {
    metodo: "DELETE",
    caminho: "/projetos/:id",
    permissao: "projetos.excluir",
    oQueFaz: "Exclui de vez um projeto sem tarefas.",
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
    permissao: "tarefas.ver",
    oQueFaz: "Avisos não lidos da própria pessoa.",
  },
  {
    metodo: "POST",
    caminho: "/avisos/:id/lido",
    permissao: "tarefas.ver",
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
    "Todas com o prefixo `/api` no site, menos `/mcp`, que fica em `https://teste.osmago.com/mcp`. As rotas da tela pedem a sessão da pessoa e passam pela verificação central de permissões.",
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
