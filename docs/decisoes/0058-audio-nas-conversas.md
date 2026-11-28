# 0058 Áudio nas conversas

- **Data:** 28/11/2026
- **Situação:** proposta (esperando o ok do Sandro)
- **Tarefa:** M8-08

## Contexto

A spec do M8 (aprovada em 27/11/2026) pede, na M8-08, duas coisas:

- **A transcrição do áudio que chega:** usa a conta de IA da empresa que tiver transcrição, com o custo para o cliente
  (decisão 8). A transcrição aparece junto do áudio e é o que o agente lê. Sem essa conta, o áudio fica sem
  transcrição e a conversa vai para uma pessoa.
- **Gravar pela caixa:** um botão de microfone na caixa grava um áudio que sai como mensagem de voz do WhatsApp.

Hoje, desde a M8-03, o áudio chega, passa pelo antivírus e fica guardado 180 dias, mas ninguém o transcreve. As
contas de IA (M4-01) conversam com os modelos, mas não transcrevem. O Mago OS também bloqueia o microfone em todas as
telas (`Permissions-Policy`, M6-04).

A tarefa não está marcada como sensível na spec. Ainda assim, mexe no custo do cliente, no que sai para um provedor de
fora e num cabeçalho de segurança. Esses pontos pedem o olho do Sandro e estão marcados com **pede o seu olho**.

## Decisão

1. **Quem transcreve.** **Pede o seu olho:**
   - Na tela Contas de IA, o administrador escolhe uma conta e um modelo de transcrição para a empresa: "Usar para
     transcrever áudio". Por exemplo, a OpenAI com `gpt-4o-mini-transcribe` ou `whisper-1`, ou a Groq com
     `whisper-large-v3`.
   - Só vale conta do tipo "compatível com OpenAI", que é o que tem o endereço de transcrição. A Anthropic e o plano
     do ChatGPT não transcrevem.
   - É uma escolha por empresa. Começa vazia, e sem ela nada é transcrito.
2. **O custo.** **Pede o seu olho:**
   - O preço é **por minuto de áudio**. Os modelos conhecidos já trazem o preço de referência (US$ 0,003 por minuto
     no `gpt-4o-mini-transcribe` e US$ 0,006 no `whisper-1`), e o administrador pode mudar o preço, como nos outros
     modelos.
   - A transcrição entra no gasto do mês da empresa e conta para o teto (M4-06). Na tela de custos aparece como
     "Transcrição de áudio".
   - Com o teto batido, nada é transcrito, e vale o item 4.
3. **O que sai para o provedor.** **Pede o seu olho:**
   - Sai só o arquivo de áudio, já conferido pelo antivírus, com até **10 minutos** e **25 MB**. Acima disso, não
     transcreve.
   - Não sai o nome do contato, nem o texto da conversa, nem nada da empresa.
   - A transcrição fica guardada na mensagem (dado pessoal). Ela continua depois que o áudio é apagado, aos 180 dias,
     como o texto das mensagens.
4. **O agente e a pessoa:**
   - O áudio entra numa fila de transcrição. O agente do canal só roda depois que a transcrição chega, e lê o áudio
     como "áudio do cliente (transcrito): ...", sempre como texto de outros.
   - Sem transcrição a conversa vai para uma pessoa, com o aviso "o cliente mandou um áudio que não deu para
     transcrever". Isso vale quando não há conta, quando a transcrição falhou, quando o áudio é longo demais e quando o
     teto foi batido.
   - Se o agente não está atendendo, a transcrição só aparece na caixa, para a equipe.
   - Na caixa, a transcrição aparece logo abaixo do player do áudio, com "Transcrição automática". Se ela falhou,
     aparece o motivo e o botão "Transcrever de novo".
5. **Gravar pela caixa.** **Pede o seu olho**, porque mexe num cabeçalho de segurança:
   - O microfone passa a ser permitido **só no próprio Mago OS** (`microphone=(self)`). A câmera, a localização, o
     pagamento e o USB continuam bloqueados, e o balão do site continua sem microfone.
   - O navegador pede a permissão na primeira vez.
   - O botão de microfone grava até **5 minutos**, mostra o tempo, e a pessoa ouve antes de mandar ou descarta.
   - O áudio sai como mensagem de voz do WhatsApp: a Evolution converte o formato do navegador para o do WhatsApp. Ele
     passa pela mesma fila, pelo mesmo ritmo e pela mesma situação da entrega da M8-03.
   - Só no WhatsApp. No balão do site, a caixa continua só com texto.
   - O áudio que a equipe grava não é transcrito.
6. **Testes** com o transcritor falso:
   - o áudio transcrito, que o agente lê como texto de outros;
   - sem conta, com falha, longo demais e com o teto batido: a conversa vai para uma pessoa;
   - o custo no gasto do mês;
   - "Transcrever de novo";
   - gravar e mandar como voz, com a Evolution falsa recebendo áudio;
   - o cabeçalho com o microfone só no próprio Mago OS;
   - o isolamento entre empresas.

## O que foi descartado

- **Transcrever com uma conta da plataforma, paga pela Nolask:** a decisão 8 da spec diz que o custo é do cliente.
- **Transcrever no próprio servidor, com um modelo aberto:** gasta memória e processador na VPS02, que divide espaço
  com a Ratoeira.
- **O agente respondendo em áudio:** fica para o M12, como a spec já diz.

## Consequências

- Banco: a escolha da conta e do modelo de transcrição na empresa, o preço por minuto no modelo, a transcrição e a
  situação dela na mensagem, e o custo da transcrição no gasto do mês.
- Contratos: a transcrição na mensagem, a escolha de quem transcreve e o áudio no pedido de mandar mensagem.
- Núcleo: a fila de transcrição, o transcritor (a chamada ao endereço de transcrição) e o falso dos testes, o agente
  esperando a transcrição, a volta para as pessoas e o envio de voz pela Evolution.
- Infra e tela: o `Permissions-Policy` com o microfone só no próprio Mago OS (no Caddy do teste e da produção e na
  prévia dos testes de tela), o botão de microfone na caixa e a escolha em Contas de IA.
- Pronto quando: o cliente manda um áudio pelo WhatsApp, a transcrição aparece na caixa e o agente responde a partir
  dela; sem conta de transcrição, a conversa vai para uma pessoa; e a pessoa grava um áudio na caixa e ele chega ao
  cliente como mensagem de voz.
