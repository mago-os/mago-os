# 0043 Rastreio de ponta a ponta e registros sem dado pessoal

- **Data:** 24/11/2026
- **Situação:** aceita (decisão 2 da spec do M6, aprovada pelo Sandro no chat em 24/11/2026)
- **Tarefa:** M6-02

## Contexto

Desde o M0-04, cada pedido tem um número de rastreio (o trace id do OpenTelemetry, decisão 0003), mas ele parava no
pedido: o trabalho que o pedido mandava para a fila (o agente, o Telegram, os anexos) rodava depois com outro número,
ou sem nenhum. Os registros ficavam só no Docker do servidor, e o destino central foi deixado para o M6-02. A
decisão 2 da spec do M6 escolheu o Grafana Cloud no plano grátis, recebendo só dados técnicos.

## Decisão

1. **O número segue o trabalho.** Cada trabalho mandado para a fila leva o número de quem o criou (e o contexto W3C
   do OpenTelemetry, quando ligado). O trabalho roda continuando esse número, e o que ele manda para a fila leva o
   mesmo número. Para funcionar com o OpenTelemetry desligado (testes e Mac), o número também anda num
   AsyncLocalStorage próprio, que o servidor preenche no começo de cada pedido. Os trabalhos da verificação a cada
   minuto ganham um número novo a cada vez.
2. **Os registros levam o número.** Fora de um pedido, cada registro ganha o número do trabalho de agora (pelo
   `mixin` do pino); no pedido, ele já vem do próprio pedido, sem repetir.
3. **Filtro dos registros.** Antes de qualquer registro sair, campos de texto livre e segredos são trocados por
   `[retirado]` pelo nome, e e-mails, chaves e tokens dentro de qualquer texto são apagados. O endereço vai sem os
   valores da consulta e sem o IP. O filtro roda no próprio pino, então vale para o Docker e para o destino central.
4. **Destino.** O OpenTelemetry manda o rastreio e os registros (pela ponte do pino) para o Grafana Cloud por OTLP,
   só quando `OTEL_EXPORTER_OTLP_ENDPOINT` existe. Entraram as instrumentações do fetch (chamadas aos provedores de
   IA, ao Telegram e ao Backblaze) e do pino. A conta, o token só de escrita (no Infisical), o painel e o alerta no
   Telegram do Sandro ficam na conta do Grafana Cloud.
5. **Erro na tela.** Quando a API falha do lado dela (5xx), a tela mostra um aviso com o número de rastreio e o
   botão Copiar. **Correção pequena na spec:** o aviso aparece só nos erros do sistema. Nos erros do pedido (senha
   errada, campo faltando), a pessoa já tem a mensagem da tela, e o número não ajuda.

## O que foi descartado

- **Grafana na própria VPS:** alternativa da decisão 2, recusada (gasta memória e é mais uma coisa para manter).
- **Guardar o número em cada linha das execuções no banco:** pedia migração e não ajuda mais do que o número nos
  registros e no rastreio.
- **Mostrar o número em todo erro, inclusive os do pedido:** ruído para quem errou a senha.
