# WhatsApp oficial da plataforma (a equipe)

O número oficial do Mago OS faz pela equipe o mesmo que o bot do Telegram: vincular a conta, falar com o coordenador, aprovar pedidos e receber os avisos urgentes ([decisão 0059](../decisoes/0059-whatsapp-da-plataforma.md), M8-09). Por enquanto, é o número de teste da Meta, que só fala com até 5 números cadastrados no painel.

## Na Meta

- **App:** "Mago OS" (app id 1524006026213037), no portfólio Nolask-BM-01.
- **Número de teste:** +1 555 153-6171 (id do número 1587526754433555). A conta dele (a WABA, id 28973061455709377) aparece hoje no Gerenciador de Negócios como **"Conta de mensagens"** ("Test Messaging Account", em Configurações › Contas › Contas de mensagens), separada de "Contas do WhatsApp", que é o número.
- **App publicado:** o app Mago OS está no modo publicado (Ao vivo) desde 28/11/2026. Enquanto não estava, a Meta só mandava ao webhook os avisos de teste do painel, nunca as mensagens de verdade. Publicar não depende da análise do acesso avançado (M7-06): com o acesso padrão, o app já fala pelos números do próprio portfólio.
- **App inscrito na conta:** a Meta só entrega as mensagens de um número aos apps inscritos na conta dele. Conferir com `GET /28973061455709377/subscribed_apps` (o Mago OS tem de aparecer; o "WA DevX Webhook Events 1P App" é da própria Meta) e inscrever com `POST /28973061455709377/subscribed_apps`. Em 28/11/2026, isso foi feito no Graph API Explorer com o login do Sandro, porque o token do `magoos-teste` não enxerga a conta pela API.
- **Usuário do sistema:** `magoos-teste`, criado em 28/11/2026 com a função **Funcionário (Employee)**, porque o portfólio só pode ter um usuário do sistema Admin e esse lugar já está ocupado. Ele precisa de acesso total no app Mago OS, no número (Contas do WhatsApp) **e na Conta de mensagens** 28973061455709377. Sem esta última, ele recebe, mas o envio dá o erro 10 ("o app não tem permissão"); depois de atribuir, leva alguns minutos para valer. A API continua listando `me/assigned_whatsapp_business_accounts` vazio para esse token, mesmo com o envio funcionando: não use essa lista para conferir. O token dele não vence e tem só as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
- **Destinatários de teste:** até 5 números, em WhatsApp › Configuração da API › "Para".
- **Modelos (Utilidade, pt_BR, rodapé "Mago OS"):** um por tipo de aviso, usados só fora da janela de 24 horas. {{1}} é o primeiro nome da pessoa. Modelo novo só com o ok do Sandro.
  - `tarefa_atribuida_v2`: "Olá, {{1}}. Você recebeu a tarefa "{{2}}" no Mago OS. Abra o Mago OS para ver os detalhes." ({{2}} = o título; a tarefa nova).
  - `lembrete_de_tarefa_v2`: "Olá, {{1}}. A tarefa "{{2}}" vence hoje. Abra o Mago OS para ver os detalhes." ({{2}} = o título; o prazo de hoje ou vencido).
  - `mencao_na_tarefa`: "Olá, {{1}}. Você foi mencionado na tarefa "{{2}}" no Mago OS. Abra o Mago OS para ver os detalhes." ({{2}} = o título).
  - `aprovacao_pedida`: "Olá, {{1}}. O agente {{2}} pediu a sua aprovação no Mago OS. Abra o Mago OS para aprovar ou recusar." ({{2}} = o nome do agente).
  - O corpo leva o texto fixo e só detalhes nas variáveis (a Meta recusa como Utilidade o modelo com o aviso inteiro numa variável, como o `aviso_do_mago_os`, que ficou de fora). Os exemplos vão nos campos de exemplo. Os outros avisos urgentes, fora da janela, ficam no app e no Telegram.
  - Os `tarefa_atribuida` e `lembrete_de_tarefa` de 27/11/2026 ficaram com os exemplos dentro do corpo e não são usados.
- **Webhook:** `https://teste.osmago.com/api/whatsapp/webhook`, com o campo `messages` assinado. O app tem um endereço só; a produção vai precisar de um app próprio ou de mudar o endereço.

## Segredos (Infisical, projeto mago-os, ambiente staging)

| Nome | O que é | Como trocar |
| --- | --- | --- |
| `MAGO_META_TOKEN` | O token permanente do usuário do sistema `magoos-teste` | No Gerenciador de Negócios › Usuários do sistema › `magoos-teste` › Gerar novo token (as duas permissões, sem expiração); gravar o novo e rodar `segredos.sh` |
| `MAGO_META_NUMERO` | O id do número na Meta (1587526754433555) | Só muda com outro número |
| `MAGO_META_SEGREDO_DO_APP` | A chave secreta do app, que confere a assinatura de cada aviso | Em Configurações do app › Básico › Redefinir; gravar a nova logo, porque a antiga para de valer |
| `MAGO_META_VERIFICACAO` | O texto do desafio do webhook (gerado com `openssl rand -hex 32`) | Gravar o novo e, no painel da Meta, editar o webhook com o mesmo texto |

As quatro juntas, ou nenhuma: sem elas, o WhatsApp da equipe fica desligado e Meu perfil avisa. O `segredos.sh` leva as quatro ao `api.env` (a cópia do servidor, em `/opt/mago-os/bin/segredos.sh`, precisa da versão nova do repositório). Depois, `publicar.sh forcar` sobe a API com elas.

## Ligar no teste

1. Os quatro segredos no Infisical (o Sandro cola; nenhum passa pelo chat).
2. Na VPS02, atualizar `/opt/mago-os/bin/segredos.sh` com o do repositório, rodar e publicar de novo (`publicar.sh forcar`). A API pergunta à Meta o número do Mago OS ao subir, e só então Meu perfil gera o código.
3. No painel da Meta, configurar o webhook com o endereço e o texto de verificação, e assinar `messages`. O botão "Testar" do campo `messages` manda um aviso de exemplo (deve aparecer um POST com 200 no registro da API).
4. Publicar o app, conferir que ele está inscrito na conta (`subscribed_apps`) e que o `magoos-teste` tem acesso total na Conta de mensagens.
5. Em Meu perfil › WhatsApp, gerar o código e mandar pelo WhatsApp. O Mago OS responde confirmando o vínculo; depois, "ajuda" mostra os comandos.

Feito no teste em 28/11/2026 (versão d0ba527): vínculo às 16h26 e primeira resposta às 16h34.

## O que fazer se falhar

- **Os avisos da Meta não chegam:** conferir o webhook no painel (endereço, campo `messages` assinado) e o registro da API (`whatsapp`). A assinatura errada responde 401: a chave secreta do app no Infisical não é a do painel. Se o "Testar" do painel chega e as mensagens de verdade não: o app não está publicado ou não está inscrito na conta (`subscribed_apps`).
- **O envio falha com o erro 10:** o `magoos-teste` não tem acesso total na Conta de mensagens. Atribuir e esperar alguns minutos; não precisa de token novo.
- **O envio falha com 131047:** a janela de 24 horas fechou. Só vai por modelo, e o aviso que não tem modelo fica no app.
- **O modelo é recusado:** o modelo não está aprovado na Meta, ou mudou. O aviso fica no app e não tenta de novo. Ao criar um modelo, se a Meta avisar que a categoria não corresponde, o texto está genérico demais: deixe o texto fixo e só nomes e títulos nas variáveis.
- **Token vencido ou revogado (401 da Meta):** gerar outro token do `magoos-teste` e trocar no Infisical.
