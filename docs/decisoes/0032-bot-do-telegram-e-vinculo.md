# 0032 Bot do Telegram e vínculo da conta por código

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026)
- **Tarefa:** M5-01

## Contexto

O M5 leva o Mago OS para o Telegram: falar com o coordenador, mandar arquivos, aprovar pedidos e receber avisos. Antes de tudo, o sistema precisa saber com certeza quem está do outro lado de cada conta do Telegram, sem abrir uma porta nova para quem não tem conta. A spec do M5 foi aprovada em 22/11/2026 com as decisões 1 a 3 (um bot da plataforma, webhook e vínculo por código).

## Decisão

1. **Um bot por ambiente.** Um bot do Mago OS para a plataforma toda, e outro só para o teste (teste.osmago.com). O Sandro cria os dois no BotFather. Segredos novos no Infisical: `MAGO_TELEGRAM_TOKEN` (o token do bot, colado pelo Sandro na web) e `MAGO_TELEGRAM_SEGREDO` (o segredo do webhook, gerado por nós). Sem o token, o Telegram fica desligado: a API sobe normal e Meu perfil diz que o bot não está ligado neste ambiente.
2. **Webhook, sem rota nova no Caddy.** O endereço é `https://teste.osmago.com/api/telegram/webhook`: o Caddy já leva `/api/*` à API. Ao subir, a API registra o webhook no Telegram (`setWebHook`, com o segredo, só mensagens individuais e só os tipos de atualização usados) e o menu de comandos (`setMyCommands`). Cada chamada é conferida pelo cabeçalho `X-Telegram-Bot-Api-Secret-Token` com comparação de tempo constante; sem ele, a resposta é 401 e nada é lido. A rota responde 200 na hora e o trabalho vai para a fila, para o Telegram não repetir a entrega. Cada `update_id` é gravado uma vez (chave única), então uma entrega repetida não faz nada.
3. **Código de vínculo.** Em Meu perfil › Telegram, a pessoa gera um código de 8 letras e números (sem 0, O, 1, I e L), de uso único, que vale 10 minutos; gerar outro anula o anterior. O banco guarda só o resumo (SHA-256) do código, com a pessoa e a empresa ativa. A tela mostra o código e o link `https://t.me/<bot>?start=<código>`, que abre o bot já mandando o código. O bot também aceita o código digitado ou colado.
4. **Uma conta por pessoa.** O vínculo liga um número de conta do Telegram a uma pessoa (único nos dois sentidos, na plataforma toda). Vincular outra conta troca a anterior; vincular a mesma conta a outra pessoa tira da primeira (as duas recebem aviso no app). Como toda tabela, o vínculo leva `empresa_id` (a empresa da conversa pelo Telegram) e RLS por `empresa_ativa()`. A mensagem que chega ainda não sabe a empresa: uma função `SECURITY DEFINER` acha o vínculo pelo número do Telegram e devolve só a pessoa e a empresa, como a chave do agente faz (migração 0016); daí em diante tudo roda com `comPessoa` nessa empresa.
5. **Empresa do Telegram.** A conversa vale para a empresa em que o código foi gerado. O comando /empresa lista só as empresas em que a pessoa tem vínculo ativo, com botões, e troca. Se a pessoa for desligada da empresa do Telegram, o vínculo do Telegram cai junto (ela vincula de novo em outra empresa).
6. **Só conversa individual.** Mensagem de grupo, supergrupo ou canal recebe só "O Mago OS só conversa com você em particular", e o bot sai do grupo. Conta sem vínculo recebe só a resposta fixa, igual para quem nunca usou e para quem foi desligado. Mensagem de outro bot é ignorada.
7. **Travas.** Cinco códigos errados em 15 minutos travam aquela conta do Telegram (contados por conta, sem depender da pessoa). Acima de 30 mensagens por minuto de uma conta, o bot ignora até o minuto virar.
8. **Desvincular.** Pelo app (Meu perfil) ou por /sair. O desligamento da pessoa na empresa do Telegram (M1-07) e a troca do Telegram cortam o vínculo na hora.
9. **Dados pessoais.** Guardamos o número da conta e do chat, o @usuário e o nome do Telegram, marcados `[pessoal]`. O texto das mensagens não é guardado nesta tarefa; na M5-02 ele entra na conversa, como as mensagens do app.
10. **Auditoria.** `telegram.vinculou`, `telegram.desvinculou` (com o motivo: pessoa, /sair, desligamento ou troca), `telegram.trocou_empresa` e `telegram.codigo_errado` (só quando trava), sem o código nem o número do Telegram nos detalhes.
11. **Envio.** Um "carteiro do Telegram" no núcleo fala com a API do Telegram (`sendMessage`, `setWebHook`, `setMyCommands`, `getMe`), sem biblioteca de terceiros, com um Telegram falso para os testes (sem rede). Mensagens sempre como texto simples, sem `parse_mode`. O limite de envio do Telegram (por chat e geral) é respeitado pela fila.

## Detalhes acertados na implementação

- **/empresa por número:** /empresa lista as empresas numeradas e /empresa 2 troca. Os botões embaixo da mensagem chegam com a M5-04 (que precisa deles para as aprovações), e aí o /empresa ganha botões também.
- **Aviso novo `telegram_desvinculado`:** vai para a pessoa que perdeu a conta do Telegram porque outra pessoa vinculou a mesma conta. A troca feita pela própria pessoa não gera aviso.
- **O código aceita** o link (/start CODIGO), o código digitado e o código com espaço, hífen ou em minúsculas.
- **Fila "telegram":** o webhook grava o número da atualização e manda para a fila, sem repetir (vincular e as travas não podem rodar duas vezes; se a fila não receber, o número é esquecido e o Telegram entrega de novo). A falha de envio da resposta só vai para o log. Texto solto de 8 letras de quem já está vinculado é conversa, não código (vincular de novo só pelo link); texto com 0, O, 1, I ou L nunca é código. O menu do bot e a ajuda mostram só os comandos que já funcionam. Texto solto, antes da M5-02, recebe a ajuda.
- **Meu perfil › Telegram:** o cartão mostra o código, o link "Abrir o Telegram" e confere a cada 3 segundos se o bot já recebeu; com o vínculo, mostra a conta, a empresa e o botão Desvincular.

## O que foi descartado

- **Perguntar ao Telegram a cada poucos segundos** (long polling): um processo sempre ligado e mais lento, e duas cópias da API brigariam pelas mesmas mensagens.
- **Biblioteca de bot (grammY, Telegraf):** o Mago OS usa poucas chamadas da API do Telegram, e cada dependência nova é mais uma coisa para revisar. Fica fácil trocar depois, se o uso crescer.
- **Vínculo por número de telefone:** o bot só recebe o telefone se a pessoa compartilhar, e o número pode ser clonado.

## Consequências

- Contrato novo em `contratos/src/canais/telegram.ts`.
- Banco: tabelas `vinculos_do_telegram`, `codigos_do_telegram` e `atualizacoes_do_telegram` (as atualizações já tratadas, apagadas depois de 7 dias), com `empresa_id` e RLS (o código guarda a pessoa e a empresa em que foi gerado; os números das atualizações já tratadas ficam no esquema do sistema, sem dado de negócio).
- Segredos novos no Infisical e no `segredos.sh` da VPS02.
- Pronto quando: o Sandro gera o código no app, abre o bot pelo link e o bot responde "Pronto, Sandro. Você está na 4xpert".
