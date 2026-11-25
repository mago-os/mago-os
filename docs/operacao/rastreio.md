# Rastreio e registros

Estado em 24/11/2026 (M6-02). Como achar um pedido pelo número de rastreio, o que vai para o destino central e o
que fazer com cada alerta.

## O número de rastreio

- Todo pedido à API ganha um número de 32 caracteres (o trace id do OpenTelemetry, decisão 0003). Ele volta na
  resposta no cabeçalho `x-rastreio` e aparece em cada registro do pedido, no campo `rastreio`.
- O número segue o trabalho inteiro: a mensagem que vira trabalho do agente, a delegação ao especialista, as
  respostas pelo Telegram, os anexos e o "Rodar agora" das rotinas levam o número do pedido que os criou
  (`nucleo/src/rastreio-dos-trabalhos.ts`). Os trabalhos da verificação a cada minuto ganham um número novo a cada
  vez.
- Quando a API falha do lado dela (erro 5xx), a tela mostra o aviso "Algo deu errado do nosso lado" com o número e
  o botão **Copiar**. É esse número que a pessoa manda ao suporte.

## O que sai do servidor (e o que não sai)

- Só sai alguma coisa quando `OTEL_EXPORTER_OTLP_ENDPOINT` está no `api.env` (vem do Infisical pelo `segredos.sh`,
  com `GRAFANA_OTLP_*`, ver [segredos.md](segredos.md)). Sem isso, o número existe e os registros ficam só no
  Docker do servidor.
- Vão para o Grafana Cloud (plano grátis, guarda 14 dias), depois que a conta existir:
  - **Rastreio:** cada pedido e cada trabalho da fila, com as consultas ao banco e as chamadas para fora (provedores
    de IA, Telegram, Backblaze).
  - **Registros:** as mesmas linhas JSON do Docker, já filtradas.
- **Nunca vai dado pessoal nem sensível** (`nucleo/src/registros.ts`, com teste):
  - campos de texto livre e segredos são trocados por `[retirado]` pelo nome (texto, título, descrição, nome, e-mail,
    senha, token, chave e parecidos);
  - e-mails, chaves de agente e de IA, credenciais e tokens dentro de qualquer texto viram `[e-mail]`, `[chave]` ou
    `[token]`;
  - o endereço do pedido vai sem os valores da consulta (a busca pode ter texto de tarefa) e sem o IP de quem pediu;
  - no rastreio, o mesmo: os endereços vão sem os valores da consulta e sem o token do bot do Telegram, e o IP e o
    navegador de quem pediu não saem (`nucleo/src/limpar-spans.ts`, com teste).
  - O código não registra textos; o filtro é a segunda barreira. Achou um dado pessoal num registro? É defeito:
    corrigir o código e acrescentar o caso ao teste do filtro.

## Achar um pedido pelo número

1. Entrar no Grafana Cloud (https://happyivy2139.grafana.net, conta do Sandro) e abrir **Explore**.
2. **O caminho do pedido:** escolher a fonte de rastreio (Tempo), colar o número no campo de busca por trace id e
   abrir. Aparece o pedido, as consultas ao banco e os trabalhos que ele criou (agente, Telegram), com o tempo de
   cada um.
3. **Os registros do pedido:** escolher a fonte de registros (Loki) e buscar
   `{service_name="mago-os-nucleo"} | rastreio="<número>"` (o número vai como campo do registro, não no texto).
4. Sem o Grafana (ou para os últimos minutos), no servidor:

   ```bash
   ssh mago-vps02
   sudo docker logs --since 24h mago-os-api-azul 2>&1 | grep '<número>'   # ou mago-os-api-verde
   ```

## Painel e alertas

O painel **Mago OS** (https://happyivy2139.grafana.net/d/mago-os/mago-os, pasta "Mago OS") mostra os erros por hora,
os pedidos por hora e por resposta, os pedidos mais lentos (acima de 1 segundo, com o número de rastreio), a fila
parada, os agentes com erro e os últimos erros. Em cima, a escolha do ambiente (teste ou produção).

Os alertas rodam a cada minuto, para o teste e para a produção (títulos "Mago OS: ..." e "Mago OS (produção): ..."),
e avisam no Telegram do Sandro pelo bot de teste (@OsMagoTesteBot), com a mensagem "Mago OS (teste): ..." ou
"Mago OS (producao): ..." e outra quando resolver. Tudo isso é montado pelo `infra/grafana/montar.py`, que pode rodar
de novo para refazer (por exemplo, numa conta nova ou para a produção).

| Alerta | O que fazer |
| --- | --- |
| Erros acima do limite (mais de 10 em 10 minutos) | Abrir o painel, ver qual rota ou trabalho falha, pegar um número de rastreio e seguir o caminho dele |
| Fila parada (uma execução de agente ficou esquecida na fila nos últimos 10 minutos) | Conferir se a API está no ar (`/api/saude`) e os registros da fila; reiniciar a API pela publicação (`publicar.sh forcar`) se ela travou |
| Agentes com erro (mais de 3 em 10 minutos) | Abrir a execução pelo número (tela do agente › execuções) e ver o passo que falhou; conta de IA sem crédito ou chave trocada é o mais comum |

## Trocar o destino ou desligar

- Desligar: apagar os três `GRAFANA_OTLP_*` no Infisical, rodar `/opt/mago-os/bin/segredos.sh` e
  `/opt/mago-os/bin/publicar.sh forcar`.
- Trocar de destino (outro serviço que aceite OTLP): só mudam o endereço e o cabeçalho de acesso; o código não muda.
