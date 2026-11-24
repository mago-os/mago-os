# 0042 Teste de vazamento entre empresas em todas as partes

- **Data:** 24/11/2026
- **Situação:** aceita (decisão 1 da spec do M6, aprovada pelo Sandro no chat em 24/11/2026)
- **Tarefa:** M6-01

## Contexto

Até o M5, cada tarefa testava o isolamento da sua parte (as tabelas, as rotas novas, os agentes). Faltava uma prova de que nenhuma parte do sistema inteiro deixa uma empresa ver ou mudar o que é da outra, e que continua assim quando entra uma rota nova. A decisão 1 da spec do M6 pediu um teste automático que percorre todas as rotas e ferramentas e fica vermelho com uma rota sem cobertura.

## Decisão

1. **A API inteira nos testes.** A montagem da API saiu do `iniciar.ts` para o `montar.ts` (`montarApi`), sem mudar o que ela faz. O servidor liga a fila, os trabalhos e a porta; o teste monta a mesma API, com todas as rotas, trocando só o que fala com fora (Telegram, modelos e provedores de IA, e-mail e anexos numa pasta).
2. **Usar e repetir.** Duas empresas com os mesmos perfis (administrador, gestor, funcionário). A empresa B usa o sistema inteiro pela API: todas as rotas, as ferramentas dos agentes internos (pelo coordenador e pelo especialista), as do MCP (pela chave do agente externo) e o Telegram. Cada pedido dela fica gravado. Depois a empresa A repete cada um, com os ids da B, pelo administrador (as consultas também pelo gestor e pelo funcionário). O que apaga ou encerra, a B só faz depois que a A tentou, para a A tentar contra linhas que existem.
3. **O que conta como vazamento.** Um id de qualquer linha da B (ou de uma pessoa que só está na B) ou a marca que vai em todo texto da B, aparecendo para a A: na resposta da API, no resultado de uma ferramenta, numa mensagem do Telegram, num aviso do tempo real (a conexão da A fica aberta o tempo todo), num push ou num e-mail. As linhas da B também não podem mudar (um retrato de todas as tabelas dela, antes e depois).
4. **Trabalhos da fila e referências cruzadas.** Os trabalhos de cada minuto (rotinas, alertas da agenda, prazos, push, Telegram, anexos, aprovações vencidas) rodam com as duas empresas cheias. No fim, nenhuma linha de uma empresa (nos esquemas public e auditoria) pode apontar, numa coluna de id ou dentro de um JSON, para um id da outra. A única exceção é a entrada que o modelo escreveu em cada passo do agente, que fica registrada como veio mesmo quando a ferramenta recusa.
5. **Rota nova.** Toda rota registrada precisa estar no roteiro da B ou na lista `FORA`, com o motivo (o login, as rotas públicas por código de convite, as do Dono da plataforma, o link assinado do depósito e o WebSocket, que é conferido à parte). Sem isso, o primeiro teste fica vermelho. O mesmo vale para as funções do banco que passam por cima do isolamento (`SECURITY DEFINER`): cada uma está numa lista conferida, com o motivo, e uma função nova sem revisão deixa o teste do banco vermelho.
6. **O que o teste achou e foi corrigido.** Uma visão salva aceitava, no filtro, o id de um projeto de outra empresa, e um pedido de aprovação de agente (interno ou externo) guardava os ids de outra empresa que o agente citou. Nada da outra empresa aparecia (o id vinha do próprio pedido), mas a linha ficava apontando para ela. Agora a visão e o pedido de aprovação só aceitam ids que existem na empresa (`idsForaDaEmpresa`, que procura em todas as tabelas da empresa com id próprio, lidas do banco, e filtra a empresa em cada consulta, além do isolamento do banco). Contam só os campos de id do pedido (tarefaId, participantes, etiquetas e parecidos): um id escrito num texto livre, que pode ser de outro sistema, não conta. A visão recebe "não encontrado" (404) e o agente recebe "algum item citado não existe nesta empresa", sem repetir os ids.
7. **Defesa em dobro.** Para conferir o teste, ele foi rodado uma vez com o isolamento do banco desligado em todas as tabelas: nenhuma rota mostrou nada da outra empresa, porque o código também filtra a empresa em cada consulta. Isso não virou regra (a garantia continua sendo o isolamento do banco, regra 2 do projeto), mas fica registrado.

## O que foi descartado

- **Uma lista de testes escrita à mão, rota por rota:** alternativa da decisão 1, recusada (uma rota esquecida passaria).
- **Tentar todos os ids da B em todas as rotas:** milhares de pedidos sem ganho; repetir o pedido de verdade da B, com os ids certos de cada rota, prova o mesmo e roda em segundos.
- **Exigir que tudo funcione sem o isolamento do banco:** mudaria a regra 2 do projeto; fica como conferência pontual.
