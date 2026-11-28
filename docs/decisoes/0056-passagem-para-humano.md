# 0056 Passagem da conversa para uma pessoa

- **Data:** 28/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 28/11/2026, com os 6 pontos como propostos)
- **Tarefa:** M8-06

## Contexto

A spec do M8 (aprovada em 27/11/2026) pede, na M8-06, a passagem do atendimento do agente para uma pessoa: os sinais
(o contato pede uma pessoa, está irritado, repete a pergunta, a conversa anda em círculos, o agente não sabe, e os
assuntos que sempre vão para uma pessoa, por canal), o resumo para a equipe, a central de prioridades, o prazo com o
escalonamento ao gestor (padrão 10 minutos), o aviso ao contato, o silêncio do agente com uma pessoa na conversa (só
sugestões) e "devolver ao agente". Hoje (M8-05) o agente só sai da conversa quando uma pessoa assume, quando ele
falha ou com a parada. Os pontos que pedem o olho do Sandro estão marcados com **pede o seu olho**.

## Decisão

1. **Os sinais, em duas camadas.** **Pede o seu olho:**
   - **Pelo sistema, sem chamar a IA** (rápido, barato e não depende do modelo): o contato pede uma pessoa com
     palavras claras ("atendente", "humano", "falar com uma pessoa", "falar com alguém", "pessoa de verdade",
     "gerente"); o contato manda a **mesma pergunta pela segunda vez** depois de o agente responder (o texto igual,
     sem acento, pontuação e maiúsculas, com 10 letras ou mais, para não contar "oi" e "ok"); a mensagem tem uma das
     palavras dos **assuntos do canal**; e a conversa **anda em círculos**: o agente já respondeu **15 vezes** desde a
     última passagem ou desde que uma pessoa falou.
   - **Pelo agente**, com uma ferramenta nova, `passar_para_uma_pessoa` (motivo, resumo e sugestão de resposta): o
     contato está irritado, o agente não sabe responder, o assunto é um dos do canal sem a palavra exata (ex.:
     "reclamação grave"), ou ele percebe que a conversa não anda.
   - Quando o sistema passa sozinho, o agente ainda roda uma vez só para escrever o resumo e a sugestão (sem
     responder ao contato); se ele falhar, a passagem acontece do mesmo jeito, sem resumo.
2. **Os assuntos do canal:** uma lista curta na tela Canais (só o administrador), até 20 assuntos de até 60 letras,
   por exemplo "desconto", "reclamação", "jurídico", "cancelamento". Vazia por padrão. Entram nas instruções do
   agente e na conferência por palavra do item 1.
3. **Ao passar:** a conversa sai de "com o agente" e vai para "esperando a equipe", sem dono. **Pede o seu olho:** a
   conversa guarda a passagem (quando, o motivo e o resumo), e a caixa mostra no alto "O agente passou para a equipe:
   <motivo>", com o resumo (o que o contato quer e o que já foi dito); a sugestão de resposta entra como a sugestão
   pendente da conversa (a da M8-05, com Enviar, Editar e Descartar). O motivo é sempre um da lista fixa (pediu uma
   pessoa, está irritado, repetiu a pergunta, conversa em círculos, o agente não soube, assunto do canal).
4. **Quem é avisado** (aviso novo `conversa_precisa_de_pessoa`, na tela, no push e no Telegram como urgente, e na
   central de prioridades): o **responsável pelo contato**, se ele estiver ativo e vir o canal; senão, a **equipe do
   canal** (a área; canal sem área, os administradores e os gestores), como na conversa nova. O texto do aviso leva o
   nome do contato, o canal e o motivo, **nunca o resumo** (ele nasce do texto do cliente e o push pode aparecer na
   tela bloqueada); o resumo aparece só ao abrir a conversa, depois da permissão.
5. **Prazo e escalonamento.** **Pede o seu olho:** cada canal ganha o **prazo para assumir**, padrão **10 minutos**
   (de 1 a 240). Se ninguém assumir (ou responder) a conversa no prazo, sai o aviso novo
   `conversa_passou_do_prazo`, urgente, para o **gestor da área do canal** (canal sem área ou área sem gestor, os
   administradores). Escala uma vez por passagem. O prazo só corre no horário de atendimento: se acabar fora do
   horário, o escalonamento espera a abertura seguinte. Chega pela tela, pelo push e pelo Telegram; o WhatsApp entra
   quando a M8-09 ligar o canal de avisos pelo WhatsApp (o mesmo aviso, sem mudar nada aqui).
6. **O contato é avisado.** **Pede o seu olho:** cada canal ganha a **mensagem de passagem**, um texto fixo do
   administrador (padrão: "Vou chamar uma pessoa da nossa equipe para continuar com você. Só um instante."). Sai
   sozinha, pela fila, no mesmo número, uma vez por passagem, nos modos "sugere" e "sozinho" (como a mensagem de fora
   do horário, não é texto do agente). Quando uma pessoa assume por conta própria, nada sai.
7. **Silêncio do agente.** Com uma pessoa na conversa (dono ou passada), o agente nunca mais manda nada ao contato.
   **Pede o seu olho**, por causa do custo: a cada mensagem do contato, ele só escreve uma **sugestão** na caixa, que a
   pessoa envia, edita ou ignora, ligada por padrão e com um botão no canal para desligar ("Sugerir respostas quando
   uma pessoa atende"). Nesse modo ele não cria tarefa, não completa o contato e não passa a conversa: só sugere. A
   sugestão enviada sai com a pessoa como autora e não conta para a autonomia gradual.
8. **Devolver ao agente:** o botão que já existe na caixa (M8-04) limpa a passagem e o prazo e descarta a sugestão
   pendente; o agente volta a responder na próxima mensagem do contato, lendo as últimas 30 mensagens (com as da
   equipe e as notas internas) e o resumo, e por isso sabe o que foi combinado. A conversa nova do contato depois de
   resolvida (passada a folga de 1 hora) nasce no modo do canal, como hoje. A conversa que a equipe reabre fica com a
   pessoa que reabriu.
9. **Testes com o provedor de IA falso:** cada sinal (as palavras, a pergunta repetida, o assunto do canal, as 15
   respostas e a ferramenta do agente), a mensagem de passagem uma vez só, o aviso ao responsável ou à equipe sem o
   resumo, o prazo e o escalonamento (uma vez, e esperando a abertura fora do horário), o silêncio (nada sai para o
   contato, só a sugestão), o botão de desligar as sugestões, a devolução e o isolamento entre empresas.

## Ajustes ao construir (28/11/2026)

- A ferramenta nova `passar_para_uma_pessoa` (motivo, resumo e sugestão), com a descrição congelada por teste e a marca `soNaPropriaConversa`. Cada execução do atendimento tem um tipo (atender, sugerir ou resumir), e só recebe as ferramentas dele: ao sugerir, ver a ficha e responder (que vira sugestão); ao resumir, ver a ficha e passar. A ferramenta de outro tipo é recusada.
- A execução que esperava na fila vira a da passagem ou a da sugestão (assim o resumo não se perde quando o contato escreve duas vezes seguidas).
- O prazo é conferido a cada minuto (fila `conversas-passagens`); a conversa em que uma pessoa já respondeu também não escala.
- A passagem fica na conversa até alguém devolver ao agente (a faixa no alto da caixa continua depois de assumir).
- Os avisos novos entram na central de prioridades, como os avisos de agentes.
- As assinaturas das ferramentas do MCP `listar_conversas` e `ver_conversa` mudaram porque a conversa ganhou a passagem.

## O que foi descartado

- **Só a IA decidir os sinais:** a pessoa que pede um atendente não pode depender do modelo acertar; as palavras
  claras passam direto.
- **Escalar para o administrador quando a área tem gestor:** o gestor é quem cuida da equipe; o administrador só
  entra quando não há gestor.
- **Avisar o contato quando uma pessoa assume por conta própria:** a conversa já segue com a pessoa, e a mensagem
  automática no meio dela confunde.

## Consequências

- Banco: no canal, os assuntos, o prazo para assumir, a mensagem de passagem e a chave das sugestões com uma pessoa;
  na conversa, a passagem (quando, motivo, resumo) e quando escalou; os dois avisos novos.
- Contratos: a ferramenta `passar_para_uma_pessoa` (com a descrição congelada por teste), os motivos, a configuração
  do canal e a passagem na conversa.
- Núcleo: os sinais na chegada da mensagem, a fila do prazo, o escalonamento, o silêncio com sugestões e a devolução.
- Telas: os campos novos em Canais e a faixa da passagem na caixa.
- Pronto quando: o contato escreve "quero falar com um atendente", recebe a mensagem de passagem, a equipe do canal
  é avisada e vê o resumo e a sugestão; ninguém assume em 10 minutos e o gestor recebe o aviso no Telegram; a pessoa
  assume, o agente só sugere; ela devolve, e o agente continua a conversa sabendo o que foi dito.
