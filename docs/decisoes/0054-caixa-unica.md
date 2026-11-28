# 0054 Caixa única das conversas

- **Data:** 27/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 27/11/2026, com os 6 pontos como propostos)
- **Tarefa:** M8-04

## Contexto

A spec do M8 (aprovada em 27/11/2026) pede, na M8-04, a tela **Conversas**: a lista com filtros, busca e visões
salvas, a conversa aberta com a ficha do contato, responder, nota interna, assumir, passar, devolver ao agente,
resolver e reabrir, respostas prontas, criar tarefa a partir da conversa, tempo real com "fulano está respondendo",
os avisos e tudo bom no celular. A base (M8-01) e o envio (M8-03) já estão na main. A tarefa não está marcada como
sensível na spec, mas alguns pontos mexem em banco, contrato e avisos, e por isso pedem o olho do Sandro antes do
código (marcados com **pede o seu olho**).

## Decisão

1. **A tela.** "Conversas" no menu (endereço `/conversas`; o `/conversa`, no singular, continua sendo a conversa com
   o coordenador), com o número das que esperam a equipe e que a pessoa vê. No computador, a lista à esquerda e a
   conversa à direita, com a ficha resumida do contato ao lado; no celular, uma coisa por vez e a ficha num botão.
2. **Filtros e busca.** Minhas, sem dono, esperando a equipe, com o agente e resolvidas; por canal e por pessoa; e a
   busca pelo nome do contato, pelo telefone e pelo texto das mensagens (sem acento e aceitando erro de digitação,
   como na busca dos contatos). **Pede o seu olho:** para a busca no texto ficar rápida, um índice novo no texto das
   mensagens; e as **visões salvas** numa tabela nova `visoes_de_conversas`, só de quem salvou, como as dos contatos.
3. **A conversa aberta.** O histórico com o ícone do canal; quem escreveu bem diferente (contato à esquerda; equipe e
   agente à direita, com o nome; a nota interna em amarelo, com a borda tracejada e "Só a equipe vê"); a situação da
   entrega de cada mensagem que sai, com "Tentar de novo" na que falhou; a foto aparece na tela, o documento e o
   áudio abrem pelo link de 5 minutos; a conversa anterior do mesmo contato, logo acima; e as tarefas ligadas ao
   contato.
4. **Ações** (permissão `conversas.editar`, com o alcance da M8-01; cada uma na auditoria, só com ids):
   - **Assumir:** a pessoa vira a dona e o agente para (a conversa sai de "com o agente").
   - **Passar:** para outra pessoa ativa da empresa que possa ver as conversas daquele canal; ela recebe um aviso.
   - **Devolver ao agente:** a conversa volta a "com o agente" e sem dono. O agente só passa a responder na M8-05;
     até lá, o botão aparece só quando o canal tem um agente.
   - **Resolver** e **reabrir:** reabrir só a conversa resolvida que ainda não tem uma mais nova do mesmo contato no
     canal (regra da decisão 0051).
5. **Responder e nota interna.** Responder usa o envio da M8-03 (texto, foto, documento; os emojis pelo teclado do
   celular e por um botão com os mais usados no computador). A nota interna nunca sai para o contato; o @ de uma
   pessoa na nota avisa essa pessoa. **Pede o seu olho:** a nota com @ gera um aviso novo, `mencao_em_conversa`.
6. **Respostas prontas.** Uma tabela nova, `respostas_prontas`, da empresa, com o nome (o que se digita depois do "/")
   e o texto. **Pede o seu olho** em quem cuida delas: proponho que todos que respondem usem, e que só o
   administrador e o gestor criem, mudem e apaguem (pela permissão `conversas.editar` com alcance "tudo").
7. **Criar tarefa da conversa.** Um botão abre a criação de tarefa já ligada ao contato, com o link da conversa na
   descrição; usa a permissão das tarefas da pessoa.
8. **Tempo real.** Como nas tarefas: o aviso leva só o tipo e o id ("a conversa X mudou"), e a tela busca pela rota
   normal, que confere a permissão. "Fulano está respondendo": a tela avisa enquanto a pessoa digita (no máximo a cada
   5 segundos), e as outras telas mostram por 8 segundos. **Pede o seu olho:** o aviso de "está respondendo" leva o id
   da conversa e o da pessoa para as telas da mesma empresa (sem nenhum texto).
9. **Avisos.** **Pede o seu olho** em dois tipos novos:
   - `conversa_nova`: uma conversa nova sem dono vai para a equipe do canal (as pessoas da área do canal; canal sem
     equipe, os administradores e os gestores).
   - `mensagem_na_conversa`: o contato escreveu numa conversa minha. Para não encher o celular, no máximo **um aviso
     a cada 5 minutos por conversa**.

   Os dois vão pela tela, pelo push e pelo Telegram (entram como urgentes no Telegram), respeitando o silêncio de cada
   pessoa.
10. **Testes:** de tela (a caixa no celular e no computador), de permissão (o funcionário não vê nem age fora do seu
    alcance; passar só para quem vê o canal), de isolamento (o teste de vazamento cobre as rotas novas) e dos avisos
    (o limite de 5 minutos).

## Ajustes ao construir (27/11/2026)

- Endereços: as ações em `/conversas-com-contatos/:id/{assumir,passar,devolver,resolver,reabrir,notas,digitando}`, o número do menu em `/conversas-com-contatos-contador`, as respostas prontas em `/respostas-prontas` e as visões em `/conversas-visoes`.
- Passar a conversa para alguém avisa essa pessoa com o mesmo aviso de "mensagem nova numa conversa minha" (não precisou de um tipo a mais).
- Criar tarefa da conversa usa as rotas das tarefas que já existem (criar e ligar o contato), com o link da conversa na descrição; a permissão é a das tarefas da pessoa.
- A fila de envio existe sempre; sem a Evolution, a mensagem fica "pendente" até ela ser ligada.
- O tempo real tem um gatilho próprio para as conversas e as mensagens (`avisar_mudanca_de_conversa`), com o mesmo formato dos outros avisos.
- A ficha da conversa na tela do contato ganhou o link "Abrir na caixa de conversas".

## O que foi descartado

- **Mostrar o texto da mensagem no push:** o push nunca leva dado do cliente (pode aparecer na tela bloqueada); o
  texto aparece só ao abrir, depois da permissão, como nas tarefas.
- **Agente respondendo antes da M8-05:** o "com o agente" fica só como situação até lá.

## Consequências

- Banco: `visoes_de_conversas`, `respostas_prontas`, o índice de busca no texto das mensagens, o gatilho do tempo
  real nas conversas e nas mensagens e os dois avisos novos.
- Contratos: as ações, a resposta pronta, a visão salva e os avisos.
- Núcleo: as rotas das ações, das respostas prontas, das visões, da busca, de "está respondendo" e de criar tarefa.
- Telas: Conversas (lista, conversa, ficha, ações, nota, respostas prontas) e o número no menu.
- Pronto quando: a equipe acha a conversa pela busca, assume, responde com uma resposta pronta, deixa uma nota com
  @ para um colega, cria uma tarefa e resolve; outra pessoa vê tudo na hora, vê "fulano está respondendo", e quem
  é de outra equipe não vê a conversa.
