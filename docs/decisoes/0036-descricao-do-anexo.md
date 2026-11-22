# 0036 Descrição do anexo, e quando, quem e por onde ele entrou

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026, "aprovado M5-03b")
- **Tarefa:** M5-03b (entrou no M5 depois do teste da M5-03, pedida pelo Sandro)

## Contexto

Depois de testar a M5-03, o Sandro perguntou se o anexo não deveria ter uma descrição e mostrar a data e a hora em que entrou. O banco já guardava quando e quem; faltava mostrar, e faltava um lugar para dizer o que é o arquivo.

## Decisão

1. **Descrição opcional**, até 500 caracteres, só texto. Escrevem e mudam: quem enviou o anexo e quem pode editar a tarefa. Tirar é mandar vazio. Vira evento de auditoria `anexo.descreveu`, sem o texto nos detalhes.
2. **Pelo app**, a descrição pode ir junto no pedido de envio, ou ser escrita depois no próprio anexo (lápis ao lado).
3. **Pelo Telegram**, a legenda costuma ser uma ordem ("anexa na tarefa do contrato"): a ferramenta `anexar_arquivo` ganha o campo `descricao`, e o coordenador escreve uma frase curta sobre o que é o arquivo, tirada da legenda ou da conversa. Ele continua sem ler o conteúdo.
4. **Por onde entrou:** o anexo guarda o canal (app ou telegram). A tela mostra "22/11 às 19:32, por Sandro, pelo Telegram".
5. **Busca:** o Ctrl+K passa a achar anexos pelo nome e pela descrição (grupo novo "Anexos"), só dos disponíveis e das tarefas que a pessoa vê. O agente vê a descrição junto com o nome (ver_tarefa e o MCP).

## Detalhes acertados na implementação

- **Quem escreveu a descrição** fica guardado (`descrito_por_pessoa_id`). Para os agentes, a descrição escrita por outra pessoa conta como texto de outros (M4-04), como o comentário: depois de ler, o que muda dados pede aprovação.
- **O agente interno** vê no ver_tarefa o nome e a descrição de cada anexo; o externo, pelo MCP, recebe o anexo inteiro (com a descrição e o canal).
- **Busca:** o trecho aparece só quando o achado foi na descrição, e a ordem pesa o nome e a descrição.
- **Tela:** o ano aparece só quando não é o deste ano; pessoa pelo primeiro nome, agente pelo nome inteiro; quem edita a tarefa também descreve os anexos dos comentários.

## Consequências

- Contratos: `descricao` e `canal` no `Anexo`, `PedidoDeDescricaoDoAnexo`, `descricao` no envio, `anexo` nos tipos da busca e o campo novo de `anexar_arquivo` (descrição congelada nova). A assinatura do `ver_tarefa` do MCP muda (o anexo traz a descrição e o canal).
- Banco: `anexos.descricao` e `anexos.canal`, com índices de busca no nome e na descrição; os anexos que vieram do Telegram antes ficam com o canal certo.
- Rota nova: `POST /tarefas/:id/anexos/:anexoId/descricao`; a lista de anexos traz os nomes de quem enviou.
