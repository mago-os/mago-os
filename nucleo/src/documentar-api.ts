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
  ModelosDoAgente,
  PedidoDeAgente,
  PedidoDeAssinaturaDePush,
  PedidoDeAvisoDeTokens,
  PedidoDeChave,
  PedidoDeComentario,
  PedidoDeContaDeIa,
  PedidoDeDecisao,
  PedidoDeDestravar,
  PedidoDeEditarAgente,
  PedidoDeEditarComentario,
  PedidoDeEditarContaDeIa,
  PedidoDeEditarEspaco,
  PedidoDeEditarItemDeChecklist,
  PedidoDeEditarLista,
  PedidoDeEditarProjeto,
  PedidoDeEspaco,
  PedidoDeEtiqueta,
  PedidoDeInstrucoes,
  PedidoDeItemDeChecklist,
  PedidoDeLiberarModelos,
  PedidoDeLimites,
  PedidoDeLista,
  PedidoDeMensagem,
  PedidoDeMudarLista,
  PedidoDeMudarProjeto,
  PedidoDeMudarRegras,
  PedidoDeMudarStatus,
  PedidoDeParada,
  PedidoDePlanejamento,
  PedidoDePrecoDoModelo,
  PedidoDeProjeto,
  PedidoDeRetomada,
  PedidoDeSkill,
  PedidoDeSkillsDoAgente,
  PedidoDeStatusDoProjeto,
  PedidoDeTarefa,
  PedidoDeTeto,
  PedidoDeTrocarResponsavel,
  PedidoDeVisaoSalva,
  PedidoDeVoltarVersao,
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
      "Lista as tarefas que a pessoa alcança (query: minhas=1, status=a,b, projeto=<id>|sem, espaco, responsaveis=p:<id>,a:<id>, agente=1, prioridades, etiquetas, prazo=atrasadas|hoje|semana|sem_prazo, de, ate, subtarefas=0, texto: no título, na descrição ou nos comentários).",
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
    caminho: "/agentes/:id/modelos",
    permissao: "agentes.ver",
    oQueFaz: "O modelo principal e o reserva do agente (M4-01), ou null.",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/modelos",
    permissao: "agentes.editar",
    oQueFaz: "Escolhe o principal e o reserva ({ modelos: ... } ou { modelos: null }). Só modelos liberados.",
    recebe: ModelosDoAgente,
  },
  {
    metodo: "GET",
    caminho: "/ia/modelos",
    permissao: "agentes.editar",
    oQueFaz: "Os modelos liberados de todas as contas de IA, para escolher o do agente.",
  },
  {
    metodo: "GET",
    caminho: "/conversas",
    permissao: "agentes.ver",
    oQueFaz: "O coordenador da empresa e as conversas da própria pessoa com ele (M4-02).",
  },
  {
    metodo: "GET",
    caminho: "/conversas/:id",
    permissao: "agentes.ver",
    oQueFaz: "As mensagens de uma conversa da própria pessoa e quantas execuções ainda rodam.",
  },
  {
    metodo: "POST",
    caminho: "/conversas/mensagens",
    permissao: "agentes.ver",
    oQueFaz:
      "Manda uma mensagem ao coordenador (sem conversaId, começa uma conversa); vira trabalho na fila.",
    recebe: PedidoDeMensagem,
  },
  {
    metodo: "DELETE",
    caminho: "/conversas/:id",
    permissao: "agentes.ver",
    oQueFaz: "Apaga uma conversa da própria pessoa (as tarefas criadas continuam).",
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/regras",
    permissao: "agentes.ver",
    oQueFaz:
      "As regras por ação do agente (M4-03), com o padrão, o ajuste e as aprovações seguidas, e o que a pessoa pode mudar (tudo, restringir ou nada).",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/regras",
    permissao: "agentes.ver",
    oQueFaz:
      "Muda as regras ({ regras: [{ acao, modo }] }, modo null volta ao padrão). O administrador muda tudo; o responsável pelo agente só deixa mais restrito.",
    recebe: PedidoDeMudarRegras,
  },
  {
    metodo: "GET",
    caminho: "/aprovacoes",
    permissao: "tarefas.ver",
    oQueFaz:
      "Os pedidos de aprovação que a pessoa decide (quem pediu, o responsável pelo agente e o administrador). Query: situacao.",
  },
  {
    metodo: "GET",
    caminho: "/aprovacoes/:id",
    permissao: "tarefas.ver",
    oQueFaz: "Um pedido de aprovação, com os parâmetros exatos e a conferência.",
  },
  {
    metodo: "POST",
    caminho: "/aprovacoes/:id/decidir",
    permissao: "tarefas.ver",
    oQueFaz:
      "Aprova (podendo editar os parâmetros) ou recusa com motivo. Manda a conferência que a pessoa viu; se o pedido mudou, 409.",
    recebe: PedidoDeDecisao,
  },
  {
    metodo: "GET",
    caminho: "/instrucoes/:camada",
    permissao: "instrucoes.ver",
    oQueFaz: "A camada da empresa (M4-05): a versão atual, o histórico e se a pessoa pode editar.",
  },
  {
    metodo: "GET",
    caminho: "/instrucoes/:camada/:alvoId",
    permissao: "instrucoes.ver",
    oQueFaz: "A camada de um projeto ou de um agente: a versão atual, o histórico e se a pessoa pode editar.",
  },
  {
    metodo: "POST",
    caminho: "/instrucoes/:camada",
    permissao: "instrucoes.editar",
    oQueFaz: "Salva uma versão nova da camada da empresa.",
    recebe: PedidoDeInstrucoes,
  },
  {
    metodo: "POST",
    caminho: "/instrucoes/:camada/:alvoId",
    permissao: "instrucoes.editar (projeto: o diretor ou quem edita todos os projetos)",
    oQueFaz: "Salva uma versão nova da camada de um projeto ou de um agente.",
    recebe: PedidoDeInstrucoes,
  },
  {
    metodo: "POST",
    caminho: "/instrucoes/:camada/voltar",
    permissao: "instrucoes.editar",
    oQueFaz: "Volta a camada da empresa para uma versão anterior (cria uma versão nova igual a ela).",
    recebe: PedidoDeVoltarVersao,
  },
  {
    metodo: "POST",
    caminho: "/instrucoes/:camada/:alvoId/voltar",
    permissao: "instrucoes.editar (projeto: o diretor ou quem edita todos os projetos)",
    oQueFaz: "Volta a camada de um projeto ou de um agente para uma versão anterior.",
    recebe: PedidoDeVoltarVersao,
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/instrucoes",
    permissao: "instrucoes.ver",
    oQueFaz:
      "O texto final que o agente recebe, com o que veio de cada camada (query: tarefa, para a camada do projeto).",
  },
  {
    metodo: "GET",
    caminho: "/skills",
    permissao: "instrucoes.ver",
    oQueFaz:
      "A biblioteca de skills (plataforma e empresa), com a versão publicada e os agentes de cada uma.",
  },
  {
    metodo: "GET",
    caminho: "/skills/:id",
    permissao: "instrucoes.ver",
    oQueFaz: "Uma skill e as versões dela.",
  },
  {
    metodo: "POST",
    caminho: "/skills",
    permissao: "instrucoes.criar",
    oQueFaz: "Cria uma skill da empresa; a primeira versão nasce como rascunho.",
    recebe: PedidoDeSkill,
  },
  {
    metodo: "POST",
    caminho: "/skills/:id/rascunho",
    permissao: "instrucoes.editar",
    oQueFaz: "Salva o rascunho (o da versão seguinte, se só houver publicadas). O nome não muda.",
    recebe: PedidoDeSkill,
  },
  {
    metodo: "POST",
    caminho: "/skills/:id/publicar",
    permissao: "instrucoes.aprovar",
    oQueFaz: "Publica o rascunho: os agentes passam a receber essa versão.",
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/skills",
    permissao: "instrucoes.ver",
    oQueFaz: "Os ids das skills atribuídas ao agente.",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/skills",
    permissao: "instrucoes.editar",
    oQueFaz: "Troca a lista de skills do agente.",
    recebe: PedidoDeSkillsDoAgente,
  },
  {
    metodo: "GET",
    caminho: "/execucoes/:id",
    permissao: "agentes.ver",
    oQueFaz:
      "Uma execução de agente interno com o resumo e os passos (M4-07). Detalhes (parâmetros e resultados) só para quem pediu, o responsável pelo agente e o administrador; quem só vê a tarefa vê o resumo e os nomes dos passos.",
  },
  {
    metodo: "GET",
    caminho: "/tarefas/:id/execucoes",
    permissao: "tarefas.ver",
    oQueFaz:
      "As execuções de agentes internos numa tarefa e o que os agentes externos fizeram nela pelo MCP.",
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/execucoes",
    permissao: "agentes.ver",
    oQueFaz:
      "As execuções recentes de um agente interno (todas para o responsável e o administrador; as próprias para os outros).",
  },
  {
    metodo: "GET",
    caminho: "/agentes/:id/limites",
    permissao: "agentes.ver",
    oQueFaz:
      "Os limites de cada execução do agente interno: rodadas e minutos (M4-08), e se foram ajustados.",
  },
  {
    metodo: "POST",
    caminho: "/agentes/:id/limites",
    permissao: "agentes.editar",
    oQueFaz: "Muda os limites do agente interno (null volta ao padrão: 30 rodadas e 10 minutos).",
    recebe: PedidoDeLimites,
  },
  {
    metodo: "GET",
    caminho: "/agentes/parada",
    permissao: "agentes.ver",
    oQueFaz: "A parada ativa da empresa (Parar todos os agentes, M4-09), com os agentes dela, ou null.",
  },
  {
    metodo: "POST",
    caminho: "/agentes/parar-todos",
    permissao: "agentes.excluir",
    oQueFaz:
      "Para todos os agentes ativos da empresa, com o motivo e o segundo fator recente. As tarefas ficam como estavam.",
    recebe: PedidoDeParada,
  },
  {
    metodo: "POST",
    caminho: "/agentes/retomar-todos",
    permissao: "agentes.excluir",
    oQueFaz:
      "Retoma os agentes da parada (todos, com agenteIds null, ou os escolhidos), com o segundo fator recente. A tarefa interrompida volta à fila.",
    recebe: PedidoDeRetomada,
  },
  {
    metodo: "GET",
    caminho: "/plataforma/agentes/paradas",
    permissao: "Dono da plataforma",
    oQueFaz: "As empresas com os agentes parados.",
  },
  {
    metodo: "POST",
    caminho: "/plataforma/agentes/parar-todos",
    permissao: "Dono da plataforma",
    oQueFaz:
      "Para os agentes de todas as empresas ativas (com o motivo e o segundo fator recente). Só o Dono retoma.",
    recebe: PedidoDeParada,
  },
  {
    metodo: "POST",
    caminho: "/plataforma/agentes/retomar-todos",
    permissao: "Dono da plataforma",
    oQueFaz:
      "Retoma os agentes das paradas feitas pelo Dono, em todas as empresas (com o segundo fator recente).",
  },
  {
    metodo: "GET",
    caminho: "/custos",
    permissao: "contas_de_ia.ver",
    oQueFaz:
      "O painel de custos do mês (query: mes=AAAA-MM): total, hoje, por agente, por conta, por dia e os modelos sem preço (M4-06).",
  },
  {
    metodo: "POST",
    caminho: "/custos/tetos/empresa",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Muda o teto de gasto da empresa por mês (null: sem teto).",
    recebe: PedidoDeTeto,
  },
  {
    metodo: "POST",
    caminho: "/custos/tetos/agente/:id",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Muda o teto de gasto de um agente interno por mês (null: sem teto).",
    recebe: PedidoDeTeto,
  },
  {
    metodo: "POST",
    caminho: "/ia/contas/:id/limite-de-tokens",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Conta por assinatura: o limite em tokens do mês e se só avisa ou para aos 100%.",
    recebe: PedidoDeAvisoDeTokens,
  },
  {
    metodo: "POST",
    caminho: "/ia/contas/:id/precos",
    permissao: "contas_de_ia.editar",
    oQueFaz: "O preço que o administrador dá a um modelo da conta (null: volta para o preço de referência).",
    recebe: PedidoDePrecoDoModelo,
  },
  {
    metodo: "GET",
    caminho: "/ia/contas",
    permissao: "contas_de_ia.ver",
    oQueFaz: "As contas de IA da empresa (sem a chave, só os 4 últimos caracteres) e se o cofre está ligado.",
  },
  {
    metodo: "POST",
    caminho: "/ia/contas",
    permissao: "contas_de_ia.criar",
    oQueFaz: "Conecta uma conta: testa a chave no provedor antes de gravar. Pede o segundo fator recente.",
    recebe: PedidoDeContaDeIa,
  },
  {
    metodo: "POST",
    caminho: "/ia/contas/:id",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Muda o nome, o teto ou troca a chave (testada antes; pede o segundo fator recente).",
    recebe: PedidoDeEditarContaDeIa,
  },
  {
    metodo: "POST",
    caminho: "/ia/contas/:id/testar",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Testa a chave guardada e atualiza a lista de modelos (os novos chegam desligados).",
  },
  {
    metodo: "GET",
    caminho: "/ia/contas/:id/modelos",
    permissao: "contas_de_ia.ver",
    oQueFaz: "Os modelos da conta, liberados ou não.",
  },
  {
    metodo: "POST",
    caminho: "/ia/contas/:id/modelos",
    permissao: "contas_de_ia.editar",
    oQueFaz: "Libera ou desliga modelos (não desliga um modelo que algum agente usa).",
    recebe: PedidoDeLiberarModelos,
  },
  {
    metodo: "DELETE",
    caminho: "/ia/contas/:id",
    permissao: "contas_de_ia.excluir",
    oQueFaz: "Apaga a conta e a chave; os agentes que a usavam ficam sem modelo.",
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
