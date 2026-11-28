# WhatsApp oficial da plataforma (a equipe)

O número oficial do Mago OS faz pela equipe o mesmo que o bot do Telegram: vincular a conta, falar com o coordenador, aprovar pedidos e receber os avisos urgentes ([decisão 0059](../decisoes/0059-whatsapp-da-plataforma.md), M8-09). Por enquanto, é o número de teste da Meta, que só fala com até 5 números cadastrados no painel.

## Na Meta

- **App:** "Mago OS" (app id 1524006026213037), no portfólio Nolask-BM-01.
- **Número de teste:** +1 555 153-6171 (id do número 1587526754433555, conta do WhatsApp 28973061455709377).
- **Usuário do sistema:** `magoos-teste`, criado em 28/11/2026 com a função **Funcionário (Employee)**, porque o portfólio só pode ter um usuário do sistema Admin e esse lugar já está ocupado. Ele tem acesso total ao app Mago OS e à conta do WhatsApp 28973061455709377. O token dele não vence e tem só as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
- **Destinatários de teste:** até 5 números, em WhatsApp › Configuração da API › "Para".
- **Modelos (Utilidade, pt_BR):** `aviso_do_mago_os` (o aviso urgente e o pedido de aprovação fora da janela de 24 horas, com o primeiro nome e o texto do aviso), `tarefa_atribuida` e `lembrete_de_tarefa`. Modelo novo só com o ok do Sandro.
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
3. No painel da Meta, configurar o webhook com o endereço e o texto de verificação, e assinar `messages`.
4. Em Meu perfil › WhatsApp, gerar o código e mandar pelo WhatsApp.

## O que fazer se falhar

- **Os avisos da Meta não chegam:** conferir o webhook no painel (endereço, campo `messages` assinado) e o registro da API (`whatsapp`). A assinatura errada responde 401: a chave secreta do app no Infisical não é a do painel.
- **O envio falha com 131047:** a janela de 24 horas fechou. Só vai por modelo, e o aviso que não tem modelo fica no app.
- **O modelo é recusado:** o modelo não está aprovado na Meta, ou mudou. O aviso fica no app e não tenta de novo.
- **Token vencido ou revogado (401 da Meta):** gerar outro token do `magoos-teste` e trocar no Infisical.
