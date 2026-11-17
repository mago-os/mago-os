# 0007 Backup em três depósitos (30 dias, 3 meses e 1 ano)

- **Data:** 16/11/2026
- **Situação:** aceita
- **Tarefa:** M0-11

## Contexto

O plano pede guardar o backup por 30 dias, 3 meses e 1 ano. O pgBackRest guarda cada depósito com uma regra de tempo só, então um depósito único não consegue manter cópias diárias por 30 dias e mensais por 1 ano.

## Decisão

1. Três depósitos no mesmo bucket do Backblaze B2, com as mesmas chaves e a mesma criptografia: repo1 diário (30 dias, com o diário de alterações contínuo), repo2 semanal (90 dias) e repo3 mensal (365 dias).
2. Em repo2 e repo3, o diário de alterações é guardado só o necessário para cada cópia abrir (`retention-archive-type=full`, `retention-archive=1`). Assim eles são pontos fixos e não crescem com o diário de um ano inteiro.
3. Teste de restauração automático, num container separado, conferindo os dados contra o banco no ar. Começou mensal e passou a semanal na M0-12, porque o Uptime Kuma não aceita prazo de aviso maior que 24 dias.
4. Regra de ciclo de vida no bucket: arquivo apagado pelo pgBackRest fica escondido por 30 dias antes de sumir.
5. Os scripts avisam o monitoramento (Uptime Kuma, M0-12) a cada execução; a falta de aviso também alerta.

## Descartado

- **Um depósito só com 1 ano de retenção:** guardaria o diário de alterações de um ano inteiro, mais caro e mais lento de restaurar.
- **Bucket separado por prazo:** mais chaves e mais configuração, sem ganho real.

## Consequências

- O diário de alterações é enviado aos três depósitos: com o banco pequeno de hoje, o custo é desprezível (dentro dos 10 GB grátis do B2).
- Trava do Object Lock em modo compliance por 30 dias, ligada em 17/11/2026 por decisão do Sandro: nenhum arquivo de backup pode ser apagado antes de 30 dias, nem por quem tiver a chave. O modo governance foi descartado porque a chave da VPS consegue furá-lo. Prazo igual ao do depósito diário: protege tudo sem guardar mais do que já se guarda, dá tempo de perceber um ataque e segura dados apagados por LGPD por no máximo uns 30 dias no backup. Testado depois de ligar: cópia completa, expiração e conferência do pgBackRest funcionando.
