# 0033 Conversa com o coordenador pelo Telegram

- **Data:** 22/11/2026
- **Situação:** proposta (aguardando o "aprovado" do Sandro)
- **Tarefa:** M5-02

## Contexto

Com o vínculo da M5-01, o bot sabe quem é a pessoa e em que empresa ela está. A M5-02 faz o texto mandado ao bot virar pedido ao coordenador, com as mesmas regras do app (M4), e a resposta voltar pelo Telegram. Decisão 4 da spec do M5, aprovada em 22/11/2026.

## Decisão

1. **A mesma conversa e o mesmo motor.** O texto do Telegram entra em `conversas` e `mensagens_de_conversa`, como no app: o mesmo coordenador, as mesmas ferramentas, regras por ação, aprovações, tetos, limites, passo a passo e a parada dos agentes. Nada de caminho paralelo: o Telegram só chama o mesmo serviço que a rota `POST /conversas/mensagens` usa, que sai da rota para uma função compartilhada.
2. **Permissão.** Sem sessão no Telegram, o núcleo calcula a permissão da pessoa na empresa do Telegram pela mesma função das telas (`permissoesNaEmpresa`). Quem não tem "ver" em Agentes recebe "O seu perfil nesta empresa não conversa com os agentes". O agente continua agindo com a menor das permissões (M4-04).
3. **O texto é da própria pessoa.** A mensagem chega pela conta vinculada, então o autor é a pessoa (não conta como "texto de outros"). Por isso as ações de alto risco continuam só no app (o coordenador já responde com o link) e as aprovações pedem o código do autenticador (M5-04).
4. **Conversas no Telegram.** O vínculo do Telegram guarda a conversa atual. O pedido seguinte continua nela, a não ser que: tenham passado 6 horas desde a última mensagem dela, a pessoa mande /nova, a pessoa tenha trocado de empresa, ou a conversa tenha sido apagada no app. Aí começa uma conversa nova, com o coordenador.
5. **Canal.** `conversas.canal` diz onde a conversa começou e `mensagens_de_conversa.canal` diz por onde cada mensagem passou; a tela mostra o ícone do Telegram. A resposta do agente vai pelo canal da última mensagem da pessoa: se ela continuar no app uma conversa do Telegram, a resposta fica só no app.
6. **Entrega da resposta.** O motor, ao gravar uma mensagem do agente ou do sistema numa conversa cuja última mensagem da pessoa veio do Telegram, marca a mensagem como "para o Telegram". Ao fim da execução, o módulo do Telegram manda as marcadas, em ordem, e grava quando mandou. Uma verificação a cada minuto manda as que ficaram para trás (servidor reiniciado), e desiste depois de 1 hora (a mensagem continua no app).
7. **Falar direto com um especialista.** Uma menção no começo ("@gerente planeja o lançamento") começa uma conversa nova com o especialista cujo nome começa por aquela palavra, com a mesma regra do app (padrão: administrador e gestor).
8. **"Digitando" e mensagens longas.** Ao receber o pedido e a cada rodada do agente, o bot mostra "digitando" (o Telegram mostra por cerca de 5 segundos). Resposta acima de 4.096 caracteres é dividida em partes, quebrando em linha ou espaço. O texto vai como texto simples, sem formatação do Telegram.
9. **Links.** Tarefas criadas ou citadas na resposta vão no fim, com o endereço para abrir no app (`https://teste.osmago.com/tarefas/<id>`). O coordenador também pode citar telas do app.
10. **Comandos novos.** /nova (conversa nova) e /tarefas (as 10 primeiras prioridades da central, com o link de cada uma). O menu do bot passa a mostrar os cinco comandos.
11. **Uma resposta de cada vez.** Como no app, enquanto o agente responde, outro texto na mesma conversa recebe "Ainda estou respondendo a mensagem anterior".
12. **O que ainda não entra.** Foto, arquivo, áudio e figurinha recebem "Por enquanto entendo só texto por aqui" (arquivos na M5-03). Botões de aprovação na M5-04.

## O que foi descartado

- **Uma conversa só e contínua por pessoa no Telegram:** o histórico cresce sem parar, cada pedido carrega o contexto inteiro (mais caro) e o app ficaria com uma conversa sem fim.
- **Mandar a resposta direto do motor ao Telegram:** o motor teria que conhecer o Telegram; com a marca na mensagem, o motor só grava e o canal entrega (e a entrega que falhou é refeita).

## Consequências

- Contratos: `CanalDaConversa` em `contratos/src/agentes/internos.ts` (campo `canal` em `Conversa` e `MensagemDeConversa`) e as constantes e respostas novas em `contratos/src/canais/telegram.ts`.
- Banco: `conversas.canal`, `mensagens_de_conversa.canal`, `mensagens_de_conversa.telegram_pendente` e `telegram_enviada_em`, e `vinculos_do_telegram.conversa_id`.
- Pronto quando: o Sandro escreve ao bot "cria uma tarefa para revisar o contrato da DFO até sexta", a tarefa aparece no app com o prazo, e a conversa está no app.
