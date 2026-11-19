# 0019 Mago OS como servidor MCP

- **Data:** 19/11/2026
- **Situação:** proposta (aguarda a aprovação do Sandro: contrato das ferramentas e porta de entrada dos agentes)
- **Tarefa:** M2-05

## Contexto

Os agentes externos (Claude no Mac, Hermes e outros) precisam pegar e fazer tarefas no Mago OS. O MCP é o padrão que eles já falam. A spec pede o servidor no próprio núcleo, em `teste.osmago.com/mcp` (sem DNS novo), com a chave do agente (M2-04), as oito ferramentas de tarefas, a mesma permissão e auditoria das rotas da tela, descrições congeladas por teste e documentação gerada.

## Decisão

1. **Endereço e transporte:** `https://teste.osmago.com/mcp`, como na spec, sem DNS novo: o Caddy ganha um `handle /mcp` que leva à rota `/mcp` do núcleo (mesma regra de IP da Cloudflare das outras rotas). Transporte HTTP do MCP ("Streamable HTTP") sem sessão no servidor: cada pedido traz a chave e é independente, o que respeita a regra 9 e funciona na troca azul e verde. Usamos o SDK oficial (`@modelcontextprotocol/sdk`) no modo de baixo nível, que aceita o JSON Schema que já sai dos contratos TypeBox, sem outra biblioteca de esquemas.
2. **Chave:** `Authorization: Bearer mago_ag_...`, conferida a cada pedido pela M2-04 (revogar vale no pedido seguinte, limites, sinal de vida). Sem chave válida, 401 antes de qualquer ferramenta.
3. **Ferramentas:** `minhas_tarefas`, `ver_tarefa`, `pegar_tarefa`, `soltar_tarefa`, `comentar`, `mudar_status`, `entregar_resultado` e `estou_vivo`, declaradas em `contratos/src/mcp/ferramentas.ts` (nome, descrição, entrada e saída). O servidor só aceita a entrada que confere com o contrato.
4. **Mesmas regras da tela:** cada ferramenta chama as mesmas funções de `nucleo/src/tarefas/servico.ts` que as rotas usam, com o agente como "quem pede": só as tarefas atribuídas a ele ou que ele pegou, só da empresa dele (RLS), trava respeitada, e cada mudança vira evento de auditoria com o agente como ator e o canal `mcp`. Leituras contam para o limite de 500 registros por hora: `ver_tarefa` conta a tarefa e cada comentário; `minhas_tarefas` conta 1 por chamada, porque o agente pergunta a cada minuto e a própria lista não pode esgotar o limite. Soltar uma tarefa que era do agente devolve-a para a pessoa responsável por ele.
5. **Agente não faz tudo:** não cria, não exclui, não troca responsável, não cancela e não reabre tarefa no M2 (permissão mínima, como na spec).
6. **Descrição congelada:** um teste guarda a impressão digital (SHA-256) de nome, descrição, entrada e saída de cada ferramenta. Mudar qualquer texto quebra o teste, e o PR precisa atualizar a assinatura de propósito (revisão humana).
7. **Texto de agente é só texto:** comentário e resultado ficam marcados pelo autor "agente" e a tela mostra sempre como texto (o React não monta HTML a partir deles).
8. **Documentação gerada:** `pnpm api:documentar` escreve `docs/api/README.md` a partir dos contratos (as ferramentas do MCP e as rotas de tarefas e agentes). O CI confere que o arquivo está em dia.

## Descartado

- **Servidor MCP separado:** mais um serviço para publicar e manter; no núcleo ele reaproveita permissões, auditoria e banco.
- **MCP com sessão no servidor (SSE de longa duração):** quebraria na troca azul e verde e com duas cópias da API.
- **Descrever as ferramentas com zod:** já temos os contratos em TypeBox, que viram JSON Schema direto.
- **Endereço `api.osmago.com`:** fica para a API pública (Fase 2), como decidido na spec.
