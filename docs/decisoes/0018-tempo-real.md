# 0018 Tempo real pelo PostgreSQL e WebSocket

- **Data:** 18/11/2026
- **Situação:** aceita (segue a spec aprovada do M2)
- **Tarefa:** M2-06

## Contexto

A spec do M2 pede que a lista e a página da tarefa se atualizem sozinhas, com um comentário aparecendo no outro aparelho em menos de 2 segundos, funcionando na troca azul e verde e com mais de uma cópia da API, sem estado no servidor (regra 9).

## Decisão

1. **Avisos nascem no banco:** gatilhos em `tarefas`, `comentarios_de_tarefa` e `agentes` chamam `pg_notify('mago_mudancas', ...)` com só a empresa, o tipo, o id e a operação. Como o aviso sai do banco, nenhum caminho (tela, MCP, rotinas) esquece de avisar, e todas as cópias da API recebem.
2. **Cada cópia da API escuta** com uma conexão própria (LISTEN), que reconecta sozinha; ao voltar, manda "reconectou" para as telas buscarem tudo de novo.
3. **WebSocket em `/api/tempo-real`** (`@fastify/websocket`), autenticado pelo cookie da sessão, com 2FA completo e vínculo ativo na empresa ativa. A pessoa só recebe avisos da empresa ativa. A sessão é conferida de novo a cada minuto; um ping a cada 25 segundos mantém a conexão viva na Cloudflare.
4. **A tela busca de novo pela rota normal**, então a permissão de cada pessoa continua valendo; o aviso não leva título, texto nem nome. Uma conexão por aba, dividida pelas telas; reconexão com espera crescente e na hora quando o celular volta do segundo plano ou a internet volta.

## Descartado

- **Mandar o dado inteiro pelo WebSocket:** teria de repetir a verificação de permissão para cada pessoa conectada; buscar pela rota é mais simples e seguro.
- **Avisar pelo código das rotas (em vez de gatilhos):** fácil de esquecer num caminho novo (MCP, rotinas).
- **Servidor de mensagens à parte (Redis):** mais um serviço para manter; o PostgreSQL já resolve no tamanho atual.
