# 0059 WhatsApp oficial da plataforma para a equipe

- **Data:** 28/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 28/11/2026, com os 6 pontos como propostos)
- **Tarefa:** M8-09

## Contexto

A spec do M8, aprovada em 27/11/2026, pede na M8-09 que o número oficial do Mago OS faça pela equipe o mesmo que o bot
do Telegram (M5):

- vincular a conta por código;
- falar com o coordenador, pelo mesmo motor e na mesma conversa do app;
- aprovar com botões e com o código do app autenticador;
- receber os avisos urgentes e o resumo do dia.

Ela também pede:

- que os avisos fora da janela de 24 horas da Meta usem os modelos aprovados, cujo custo é da plataforma (decisão 6);
- que a pessoa escolha por onde recebe os avisos;
- que o webhook confira a assinatura de cada aviso da Meta;
- testes com uma Meta falsa.

A tarefa começa com o **número de teste** do app "Mago OS" da Nolask na Meta (+1 555 153-6171), que só fala com até 5
números cadastrados no painel da Meta. O número oficial da Nolask para a produção (decisão 6) ainda está pendente.

A spec marca a tarefa como sensível, porque os agentes passam a agir por um canal de fora. Os pontos que precisam do
seu olho estão marcados com **pede o seu olho**.

## Decisão

1. **Um núcleo comum ao Telegram e ao WhatsApp.**
   - O vínculo por código, a conversa com o coordenador, as aprovações e os avisos já existem para o Telegram. Esse
     código passa a ser comum aos dois canais da equipe.
   - Cada canal fica só com o próprio carteiro, isto é, a parte que fala com o Telegram ou com a Meta.
   - O comportamento do Telegram não muda. Os testes dele continuam passando sem mudança.
2. **Segredos e ligação.** **Pede o seu olho:** são quatro segredos novos no Infisical, um para cada ambiente.
   - `MAGO_META_TOKEN`: um token permanente de um usuário do sistema do portfólio Nolask-BM-01, só com as permissões
     de mensagens do WhatsApp. Você gera esse token no Gerenciador de Negócios e cola no Infisical; eu te guio por
     prints, sem ver o token.
   - `MAGO_META_NUMERO`: o id do número de teste.
   - `MAGO_META_SEGREDO_DO_APP`: a chave secreta do app, usada para conferir a assinatura.
   - `MAGO_META_VERIFICACAO`: o texto de verificação do webhook, que nós geramos.
   - Sem esses segredos, o WhatsApp da equipe fica desligado, e Meu perfil diz isso.
3. **O webhook.** **Pede o seu olho:**
   - O endereço é `https://teste.osmago.com/api/whatsapp/webhook`. Não precisa de rota nova no Caddy, porque ele já
     leva `/api/*` à API.
   - O GET responde ao desafio da Meta, só com o texto de verificação certo.
   - Cada POST é conferido pela assinatura `X-Hub-Signature-256`: um HMAC SHA-256 do corpo com a chave secreta do app,
     comparado em tempo constante. Sem assinatura válida, a resposta é 401 e nada é lido.
   - A rota responde 200 na hora e manda o trabalho para a fila. Cada id de mensagem da Meta é gravado uma vez só.
   - O app da Meta tem um único endereço de webhook, que por agora aponta para o teste. Quando a produção chegar, ela
     ganha um app próprio ou o endereço muda para lá; isso entra junto com o número da produção.
   - O webhook separa os avisos pelo id do número. Os do número da plataforma vão para a equipe; os dos números das
     empresas ficam para a M8-10.
4. **Vincular.**
   - Em Meu perfil › WhatsApp, a pessoa gera um código: 8 letras, uso único, vale 10 minutos, como no Telegram.
   - O link `https://wa.me/<número>?text=<código>` abre o WhatsApp já com o código. A pessoa manda, e o número dela
     fica ligado à pessoa e à empresa.
   - Uma pessoa tem um número só, e um número tem uma pessoa só.
   - Valem as mesmas travas do Telegram: 5 códigos errados em 15 minutos e 30 mensagens por minuto.
   - O número da pessoa é guardado como dado pessoal.
   - Desvincular: pelo app ou mandando "sair".
5. **Conversa com o coordenador.**
   - É o mesmo motor e a mesma conversa do app, igual ao Telegram. Uma conversa nova começa depois de 6 horas ou com
     a mensagem "nova".
   - A empresa troca com "empresa".
   - As respostas vão como texto.
   - Neste começo, foto, documento e áudio que chegam recebem "Por aqui, por enquanto, só texto: mande o arquivo pelo
     app ou pelo Telegram".
6. **Aprovações.**
   - Chegam com dois botões, Aprovar e Recusar. O que exige o app autenticador pede o código de 6 números, como no
     Telegram (M5-04).
   - Os botões só funcionam dentro da janela de 24 horas. Fora dela, vai o aviso por modelo do item 7, e a pessoa
     aprova no app.
7. **Avisos e a janela de 24 horas.** **Pede o seu olho**, porque é custo da Nolask e passa pela Meta:
   - Vão os mesmos avisos urgentes do Telegram e o resumo do dia, no horário que a pessoa escolheu, respeitando o
     silêncio dela.
   - Dentro da janela, que é aberta pela última mensagem da pessoa, vão como texto, sem custo de modelo.
   - Fora da janela, só vão por modelo aprovado:
     - `tarefa_atribuida` para a tarefa nova;
     - `lembrete_de_tarefa` para o prazo.
   - Para os outros urgentes (menção, precisa de ajuda, agentes parados, conversa de cliente), proponho **um modelo
     novo**, `aviso_do_mago_os`, de Utilidade em pt_BR: "Olá, {{1}}. Há um aviso no Mago OS: {{2}}. Responda aqui
     para ver os detalhes."
     - Só mando esse modelo para a Meta com o seu ok.
     - Enquanto a Meta não aprovar, esses avisos ficam só no app e no Telegram.
   - O resumo do dia fora da janela não vai, para não gastar modelo todo dia.
   - Teto de custo: no máximo **10 modelos por pessoa por dia**. Passou disso, o resto fica no app.
   - Antes de ligar, eu confiro o preço atual da Meta por mensagem de Utilidade no Brasil.
8. **Preferências.**
   - Em Meu perfil › Notificações, ao lado de Telegram, entra a coluna WhatsApp.
   - Ela só vale com o WhatsApp vinculado e começa com os mesmos urgentes do Telegram.
   - A pessoa liga um, o outro ou os dois.
9. **Testes com a Meta falsa:**
   - a assinatura certa e a errada;
   - o desafio do webhook;
   - o código de vínculo e as travas;
   - a conversa com o coordenador;
   - os botões de aprovação e o código do autenticador;
   - o aviso dentro e fora da janela;
   - o teto de 10 modelos por dia;
   - o resumo;
   - as preferências;
   - a mensagem repetida da Meta;
   - o número de uma empresa que não é da plataforma (ignorado, fica para a M8-10);
   - o isolamento entre empresas.

## Ajustes ao construir (28/11/2026)

- **O núcleo comum ficou nas regras que não dependem do canal:** o código de vínculo e o resumo dele, a lista das prioridades, a divisão das mensagens longas, o autenticador e as travas das aprovações (por pessoa, as mesmas do Telegram). As tabelas, o roteamento das mensagens e as entregas do WhatsApp são próprios, ao lado dos do Telegram, para não mexer no Telegram que já roda (os testes dele continuam iguais).
- **As palavras** valem sem barra: nova, tarefas, empresa (e "empresa 2", ou o botão com as empresas, até 3), sair e ajuda. A mensagem que é só um código de 8 letras sempre tenta vincular (assim o link do wa.me serve também para trocar a empresa por um código novo).
- **O código do autenticador fica no chat:** a Meta não deixa apagar a mensagem da pessoa. Ele vale uma vez e por 30 segundos, como no Telegram.
- **A decisão de um pedido** que terminou por outro caminho (o app, o Telegram, venceu) vai como texto, só dentro da janela: a Meta não deixa editar a mensagem nem tirar os botões, e tocar num pedido decidido responde a situação.
- **Fora da janela,** a tarefa nova vai pelo modelo `tarefa_atribuida` e o prazo (de hoje ou vencido) pelo `lembrete_de_tarefa`, os dois com o primeiro nome e o título da tarefa ({{1}} e {{2}}); os outros avisos urgentes e o pedido de aprovação vão pelo `aviso_do_mago_os`, com o primeiro nome e o texto do aviso. Sem o modelo aprovado na Meta, o envio falha e o aviso fica no app (sem tentar de novo). Em 28/11/2026, o corpo dos dois modelos antigos precisava de correção na Meta (os exemplos tinham ido para dentro do corpo, e o lembrete estava como Marketing).
- **O número do Mago OS** para o link do wa.me vem da própria Meta ao subir a API (`display_phone_number` do id do número); até ela responder, Meu perfil não gera código.
- **Filas:** `whatsapp` (os avisos da Meta) e `whatsapp-entregas` (a verificação a cada minuto). As respostas e os pedidos de aprovação também saem ao fim de cada execução, como no Telegram.
- **Endereços:** `GET` e `POST /whatsapp/webhook` (só com a Meta ligada), `GET /conta/whatsapp`, `POST /conta/whatsapp/codigo` e `DELETE /conta/whatsapp`.

## O que foi descartado

- **Usar a Evolution com um número da Nolask para a equipe:** o número pode ser bloqueado, e a spec pede o oficial
  da Meta.
- **Copiar o código do Telegram para o WhatsApp:** seriam duas versões das mesmas regras (vínculo, aprovações,
  avisos), que acabariam ficando diferentes.
- **Mandar o resumo do dia por modelo todo dia:** gasta dinheiro da Nolask com uma mensagem que pode esperar o app.

## Consequências

- Banco: o vínculo do WhatsApp (número, pessoa e empresa), os códigos de vínculo, as mensagens da Meta já tratadas,
  a última mensagem da pessoa (a janela), a contagem dos modelos do dia, `avisos.whatsapp_pendente` e a coluna
  WhatsApp nas preferências.
- Contratos: o canal da equipe WhatsApp, os avisos dele e a preferência.
- Núcleo: o núcleo comum do canal da equipe, o carteiro da Meta e a Meta falsa, o webhook com a assinatura, e as filas.
- Infra: os segredos novos no `segredos.sh` da VPS02. Sem rota nova no Caddy.
- Telas: Meu perfil › WhatsApp e a coluna nas notificações.
- Pronto quando: o Sandro gera o código no app, manda pelo WhatsApp para o número de teste, fala com o coordenador,
  aprova um pedido com o botão e recebe um aviso urgente de tarefa.
