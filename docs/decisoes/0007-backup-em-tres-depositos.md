# 0007 Backup em três depósitos (30 dias, 3 meses e 1 ano)

- **Data:** 16/11/2026
- **Situação:** aceita
- **Tarefa:** M0-11

## Contexto

O plano pede guardar o backup por 30 dias, 3 meses e 1 ano. O pgBackRest guarda cada depósito com uma regra de tempo só, então um depósito único não consegue manter cópias diárias por 30 dias e mensais por 1 ano.

## Decisão

1. Três depósitos no mesmo bucket do Backblaze B2, com as mesmas chaves e a mesma criptografia: repo1 diário (30 dias, com o diário de alterações contínuo), repo2 semanal (90 dias) e repo3 mensal (365 dias).
2. Em repo2 e repo3, o diário de alterações é guardado só o necessário para cada cópia abrir (`retention-archive-type=full`, `retention-archive=1`). Assim eles são pontos fixos e não crescem com o diário de um ano inteiro.
3. Teste de restauração automático todo mês, num container separado, conferindo os dados contra o banco no ar.
4. Regra de ciclo de vida no bucket: arquivo apagado pelo pgBackRest fica escondido por 30 dias antes de sumir.
5. Os scripts avisam o monitoramento (Uptime Kuma, M0-12) a cada execução; a falta de aviso também alerta.

## Descartado

- **Um depósito só com 1 ano de retenção:** guardaria o diário de alterações de um ano inteiro, mais caro e mais lento de restaurar.
- **Bucket separado por prazo:** mais chaves e mais configuração, sem ganho real.

## Consequências

- O diário de alterações é enviado aos três depósitos: com o banco pequeno de hoje, o custo é desprezível (dentro dos 10 GB grátis do B2).
- O prazo de trava do Object Lock (proteção contra alguém apagar os backups com a chave) ainda não foi definido: depende de decisão do Sandro, porque o modo mais forte não pode ser desfeito.
