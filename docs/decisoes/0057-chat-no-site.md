# 0057 Chat no site

- **Data:** 28/11/2026
- **Situação:** proposta (esperando o ok do Sandro)
- **Tarefa:** M8-07

## Contexto

A spec do M8 (aprovada em 27/11/2026) pede, na M8-07, o chat no site. Inclui:

- a configuração do canal "Chat no site", que gera uma linha de código para colar no site;
- o balão isolado do site e só nos domínios da lista;
- o contexto da página;
- o visitante lembrado por 30 dias (decisão 9);
- o agente pegando o e-mail ou o WhatsApp;
- "continuar no WhatsApp" sem perder o histórico;
- os limites, o bloqueio de robôs e o aviso de privacidade;
- a conversa na caixa com o ícone próprio.

A spec marca a tarefa como sensível, porque é código do Mago OS rodando no site de outra empresa e uma porta aberta
para quem não tem login. Os pontos que pedem o olho do Sandro estão marcados com **pede o seu olho**.

## Decisão

1. **Como o balão entra no site.** **Pede o seu olho:**
   - A linha de código é `<script src="https://teste.osmago.com/balao.js" data-canal="<chave do canal>" async></script>`
     (em produção, o domínio da produção).
   - O `balao.js` é pequeno (menos de 5 KB) e só desenha o botão redondo. Ao clicar, abre um **quadro (iframe)** com a
     página do balão, servida pelo Mago OS no domínio do Mago OS.
   - O site não lê nada do quadro, e o quadro não lê nada do site: os dois só trocam o endereço e o título da página,
     por mensagem entre janelas.
   - Toda a conversa acontece dentro do quadro, que fala só com a API do Mago OS, no mesmo domínio (sem abrir o CORS).
   - A página do balão é leve, sem o app inteiro, e boa no celular (ocupa a tela toda).
2. **Só nos domínios da lista.** **Pede o seu olho:**
   - Hoje o Mago OS proíbe abrir dentro de outro site (`frame-ancestors 'none'`). A exceção vale só para a página do
     balão: o cabeçalho dela traz os domínios do canal (`frame-ancestors https://loja.com.br ...`), e o navegador
     recusa abrir o quadro em qualquer outro site.
   - A lista tem até 10 domínios exatos, só `https`, e o subdomínio é escrito por inteiro.
   - Quem não usa navegador (um robô) consegue chamar a API direto. Por isso valem as proteções do item 6.
3. **A chave do canal e o visitante.** **Pede o seu olho:**
   - A linha de código leva uma **chave pública** do canal: 22 letras ao acaso, que não é o id e não dá acesso a nada
     além de abrir o balão. O administrador pode trocar a chave, e a antiga para de funcionar.
   - O visitante recebe no primeiro acesso um **código do visitante** ao acaso, que o navegador guarda por 30 dias.
     O banco guarda só o resumo (hash) do código. O visitante só vê a própria conversa.
   - As rotas do balão são públicas (sem login), mas ficam separadas das outras em `/balao/*`. Elas só leem e escrevem
     a conversa daquele visitante naquele canal, e cada ação entra na auditoria com os ids.
4. **A conversa e o contato do visitante.** **Pede o seu olho:**
   - A primeira mensagem cria um contato "Visitante do site", **não identificado**, e a conversa no canal, como no
     WhatsApp. Daí em diante o agente, a passagem e a caixa funcionam igual.
   - O agente tenta, de forma natural, pegar o nome, o e-mail ou o WhatsApp, e `completar_cliente` passa a aceitar o
     telefone também (a descrição congelada muda).
   - Se o e-mail ou o telefone já estiver em outro contato, **nada se junta sozinho**: a pessoa da equipe vê "pode
     ser o contato X" na conversa e troca com um clique ("trocar o contato", que já existe). A palavra do visitante
     não prova quem ele é, e ligar sozinho deixaria o agente mostrar a ficha de outro cliente a quem digitou o e-mail
     dele.
   - Sem nenhum contato deixado, a conversa e o contato do visitante são apagados depois de 90 dias (decisão 9, LGPD).
5. **"Continuar no WhatsApp".** **Pede o seu olho:**
   - O botão abre o WhatsApp do canal escolhido (`wa.me`), com a mensagem pronta "Oi! Vim do site (código ABC123)".
   - Quando essa mensagem chega pela Evolution com um código válido (30 minutos, uso único), o sistema liga o
     visitante ao contato do telefone: a conversa do site passa para esse contato e a linha do tempo mostra as duas.
     Aqui pode ligar sozinho, porque quem mandou a mensagem é dono do número e clicou no balão.
   - Sem código, ou com o código vencido, a mensagem é uma conversa normal do WhatsApp.
6. **Proteções.** **Pede o seu olho**, por causa do custo de IA e do abuso:
   - **Limites:**
     - por visitante, 20 mensagens em 10 minutos;
     - por endereço de internet, 30 mensagens por minuto;
     - por canal, 300 mensagens por hora e 60 visitantes novos por hora.
     - Acima disso, o balão pede para esperar e o agente não roda.
   - **Tamanho:** cada mensagem tem até 1.000 letras, só texto (arquivos pelo balão ficam para depois).
   - **Robôs:**
     - um campo escondido que pessoas não preenchem;
     - um tempo mínimo entre abrir e mandar;
     - uma prova de trabalho leve, que o navegador resolve em menos de 1 segundo e sem a pessoa ver nada.
     - Não uso Cloudflare Turnstile nem reCAPTCHA, para não pôr um serviço de fora nem cookie de terceiros no balão.
   - **Aviso de privacidade:** antes da primeira mensagem, o balão mostra "Ao conversar, você concorda com a política
     de privacidade", com o link do canal. O link é **obrigatório** para ligar o balão.
7. **Contexto da página.**
   - O agente recebe o endereço e o título da página em que o visitante está, como dado de fora (texto de outros).
   - O endereço é guardado **sem a parte depois do "?" e do "#"**, onde costumam ir e-mails e códigos.
   - A caixa mostra a página de onde o visitante veio e a última que ele abriu.
8. **As respostas chegam ao balão.**
   - O quadro pergunta por mensagens novas a cada 3 segundos com o balão aberto e a cada 20 com ele fechado (sem
     conexão aberta o tempo todo).
   - A mensagem que sai fica "entregue" quando o balão a recebe e "lida" quando o balão aberto a mostra.
   - Quem assume na caixa responde por ali, como no WhatsApp.
9. **A tela Canais > "Chat no site"** (só o administrador) tem:
   - nome, domínios, cor, posição (direita ou esquerda) e mensagem de boas-vindas;
   - o link da política de privacidade;
   - o agente e o modo, como na M8-05, e a passagem, como na M8-06;
   - "continuar no WhatsApp" (sim ou não, e com qual número);
   - a linha de código com o botão Copiar e "Trocar a chave".
10. **Testes:**
    - a página do balão com os domínios no cabeçalho, e o quadro recusado num site fora da lista (teste de tela com
      uma página de outro endereço);
    - a chave trocada para de funcionar;
    - um visitante não vê a conversa de outro;
    - os limites e a prova de trabalho;
    - o endereço sem "?" e "#";
    - o contato repetido sem juntar;
    - "continuar no WhatsApp" com o código (e sem ele);
    - o apagamento em 90 dias;
    - o isolamento entre empresas.

## O que foi descartado

- **O balão escrito direto na página do site, sem quadro:** o código do Mago OS ficaria misturado ao do site, e um
  site com problema poderia ler a conversa.
- **Ligar sozinho o visitante ao contato pelo e-mail que ele digitou:** qualquer um poderia se passar por um cliente.
- **Conexão aberta o tempo todo (WebSocket) para o balão:** o tempo real da equipe já usa, mas para visitantes de
  fora a pergunta a cada poucos segundos é mais simples de proteger e de limitar.
- **CAPTCHA:** atrapalha as pessoas e põe um serviço de fora no balão.

## Consequências

- Banco: no canal do site, a chave pública, os domínios, a aparência, a boas-vindas, o link da privacidade e o
  WhatsApp para continuar; os visitantes (o resumo do código, quando venceu); o código de "continuar no WhatsApp"; a
  página na mensagem; e o apagamento em 90 dias.
- Contratos: as rotas públicas do balão, a configuração do canal do site e o telefone em `completar_cliente`.
- Núcleo: as rotas `/balao/*`, os limites e a prova de trabalho, o código do WhatsApp na chegada da Evolution e o
  prazo de 90 dias.
- Infra: o Caddy passa `/balao.js` e `/balao/*` com o cabeçalho próprio (a exceção ao `frame-ancestors 'none'`).
- Telas: o `balao.js`, a página do balão e a configuração em Canais.
- Pronto quando: a 4xpert cola a linha no site, um visitante conversa pelo balão, o agente responde sabendo a
  página, o visitante deixa o WhatsApp e continua por lá com o histórico na linha do tempo; num site fora da lista o
  balão não abre.
