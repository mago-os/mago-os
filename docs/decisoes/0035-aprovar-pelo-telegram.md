# 0035 Aprovar pelo Telegram, com botões e o código do app autenticador

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026)
- **Tarefa:** M5-04

## Contexto

Os pedidos de aprovação dos agentes (M4-03) hoje se decidem só no app. A M5-04 leva o pedido ao Telegram, com botões, sem abrir uma porta para quem pegar o celular desbloqueado. A decisão 6 da spec do M5 (aprovada em 22/11/2026) pede botão mais o código do app autenticador, sem PIN fixo, com trava depois de 3 erros.

## Decisão

1. **Quem recebe.** O pedido vai ao Telegram das mesmas pessoas que recebem o aviso no app (quem pediu e o responsável pelo agente), quando elas têm o Telegram vinculado naquela empresa. Vai uma mensagem com o agente, o resumo (o mesmo do app, montado pelo núcleo), o porquê (texto do agente, só como texto), os parâmetros e quando vence, e os botões Aprovar, Recusar e Abrir no app.
2. **Quando vai.** Ao fim de cada execução do agente (como as respostas da M5-02) e na verificação a cada minuto. Cada envio fica registrado com a conferência (o resumo SHA-256 dos parâmetros) que a pessoa viu, e o número da mensagem no Telegram.
3. **Aprovar pede o código.** O toque em Aprovar abre um pedido de código de 5 minutos, só para aquele pedido e só para aquela conta do Telegram. A próxima mensagem com 6 dígitos é conferida com o segredo do app autenticador da pessoa (o mesmo do login, lido do jeito que o Better Auth guarda). O código usado não vale de novo, nem dentro dos mesmos 30 segundos. A mensagem com o código é apagada do chat logo depois.
4. **Sem app autenticador, sem aprovar pelo Telegram.** Quem só tem passkey vê a explicação e o botão Abrir no app. Recusar continua pelo Telegram.
5. **Trava.** Três códigos errados travam as aprovações pelo Telegram daquela pessoa por 15 minutos, e ela recebe o aviso no app. O login e o app não são afetados.
6. **Recusar pede o motivo.** O toque em Recusar pede o motivo na próxima mensagem (ou "sem motivo"), dentro de 5 minutos.
7. **Aprova o que foi mostrado.** A decisão pelo Telegram usa a conferência registrada no envio: se o pedido mudou depois (editado por outra pessoa), a aprovação é recusada e a pessoa abre no app. A execução, a auditoria e os avisos são os mesmos do app: a lógica de decidir sai da rota para um serviço comum (`decidirAprovacao`), e o Telegram só muda a origem (canal "telegram").
8. **Avisos.** Toda aprovação ou recusa pelo Telegram avisa no app quem decidiu, os outros administradores e quem pediu. A mensagem do pedido no Telegram é editada para mostrar a decisão, sem os botões. Pedido já decidido ou vencido: o botão só mostra o que aconteceu.
9. **O bot nunca pede código fora disso.** Só depois do toque em Aprovar, e só para aquele pedido. A ajuda do bot já diz isso (M5-01), e o texto do pedido também.
10. **Fora do Telegram, sempre.** As ações de segurança (parar e retomar os agentes, pessoas, permissões) e editar os parâmetros antes de aprovar continuam só no app.
11. **/empresa com botões.** Como prometido na decisão 0032, a lista do /empresa ganha um botão por empresa (o número continua valendo).

## Detalhes acertados na implementação

- **Serviço comum:** `decidirAprovacao` (`nucleo/src/agentes-internos/aprovacoes.ts`) é chamado pela rota do app e pelo Telegram; a auditoria leva o canal nos detalhes, e a conversa do agente diz "aprovou pelo Telegram".
- **O código:** conta própria do padrão (RFC 6238, HMAC-SHA1, 30 segundos, 6 dígitos), aceitando o passo anterior e o seguinte, como o login. O segredo é aberto com a função do Better Auth e o segredo do login. Código repetido conta como errado.
- **Outra mensagem no meio:** com o pedido de código aberto, uma mensagem que não é um código de 6 dígitos fecha o pedido e segue como conversa. Código mandado depois dos 5 minutos é apagado e recebe "o tempo acabou".
- **Mensagem do pedido atualizada** com a decisão (de quem decidiu, pelo app ou pelo Telegram) ou com o vencimento, na verificação a cada minuto e logo depois da decisão pelo Telegram.
- **Aviso da trava** em `telegram_aprovacoes_travadas`, com a orientação de trocar a senha se não foi a pessoa.
- **A trava conta do terceiro erro** (15 minutos a partir dele, não uma janela que vai andando), e respeita também a trava do 2FA do login: com o login travado por códigos errados, o Telegram não aceita código.
- **O botão vale para a empresa do pedido:** quem está em duas empresas e trocou a do Telegram ainda aprova o pedido que chegou da outra. O pedido de código aberto é um por pessoa.
- **Recusa com um comando no meio** (/ajuda, /empresa): desiste da recusa e o comando roda.
- **Mensagem do pedido:** "aprovado" só aparece depois que a ação terminou (se falhar, aparece "não deu certo"); a mensagem só fica marcada como atualizada depois que o Telegram aceitou a edição; reserva de envio presa (a API caiu no meio) é solta depois de 5 minutos.
- **/empresa:** o botão leva o id da empresa (não a posição na lista), para um botão antigo nunca levar a outra empresa.

## O que foi descartado

- **PIN fixo** para quem não usa autenticador: fica escrito no histórico do chat (decisão de 14/11/2026).
- **Código pelo próprio bot** (o bot manda um código e a pessoa repete): não prova nada, porque quem tem o celular tem o chat.
- **Desfazer:** a ação aprovada já aconteceu; o aviso deixa claro o que foi feito (decisão 6 da spec).

## Consequências

- Contratos: `BotaoTocadoNoTelegram` e `callback_query` na atualização, `DADOS_DOS_BOTOES`, os prazos e as respostas novas em `contratos/src/canais/telegram.ts`.
- Banco: tabela `aprovacoes_no_telegram` (o envio de cada pedido a cada pessoa, com a conferência e a mensagem) e, no esquema `telegram`, o pedido de código em aberto, os erros de código e o último passo do autenticador usado por pessoa.
- Pronto quando: o Gerente de projetos pede aprovação para atribuir uma subtarefa, o pedido chega no Telegram do Sandro, ele aperta Aprovar, manda o código do autenticador e a subtarefa é atribuída.
