# 0003 API: configuração, registros, rastreio e fila

- **Data:** 16/11/2026
- **Situação:** aceita
- **Tarefa:** M0-04

## Contexto

A spec pede um servidor Fastify configurado só por variáveis de ambiente e sem estado, uma rota de saúde da API e do banco, registros padronizados com número de rastreio em cada pedido (base do OpenTelemetry) e a fila pg-boss instalada.

## Decisão

1. **Configuração:** só variáveis de ambiente (`DATABASE_URL`, `PORTA`, `HOST`, `NIVEL_REGISTRO`, `AMBIENTE`), conferidas na subida por código próprio. Se faltar algo, a API não sobe e diz tudo o que está errado de uma vez.
2. **Registros:** o pino que já vem no Fastify, uma linha JSON por registro, com os campos em português (`hora`, `nivel`, `mensagem`, `servico`, `ambiente`, `rastreio`). O Docker guarda as linhas; o destino central fica para o M6-02.
3. **Número de rastreio:** é o trace id do OpenTelemetry (32 caracteres hexadecimais). Aparece em todos os registros do pedido e volta na resposta no cabeçalho `x-rastreio`, para o Sandro ou um agente informarem o número ao relatar um problema.
4. **OpenTelemetry:** SDK do Node com as instrumentações de HTTP, Fastify (`@fastify/otel`, a oficial do Fastify) e PostgreSQL, carregadas antes de tudo (`node --import ./src/rastreio.ts`). Nada sai do servidor até existir `OTEL_EXPORTER_OTLP_ENDPOINT`; o destino dos dados é escolhido no M6-02.
5. **Rota de saúde (`GET /saude`):** responde 200 com tudo bem e 503 quando o banco está fora do ar. A API continua no ar e volta ao normal sozinha quando o banco volta.
6. **Fila:** pg-boss no próprio PostgreSQL (esquema `pgboss`), iniciada junto com a API. Sem serviço extra para manter.

## Descartado

- **Biblioteca de validação (zod, envalid) para a configuração:** são cinco variáveis; código próprio é mais simples. Reavaliar quando passar de umas quinze.
- **Número de rastreio próprio (UUID):** não liga com o rastreio técnico do M6-02; o trace id serve aos dois.
- **Redis ou BullMQ para a fila:** mais um serviço para manter, fazer backup e proteger.

## Consequências

- Os testes de unidade usam um banco falso; o teste com o banco de verdade roda no ambiente local (`pnpm local:subir`) e entra no GitHub Actions no M0-07.
- Os scripts de instalação de pacotes continuam bloqueados (`allowBuilds` no `pnpm-workspace.yaml`); o do protobufjs, trazido pelo OpenTelemetry, ficou explicitamente desligado porque só mostra um aviso.
