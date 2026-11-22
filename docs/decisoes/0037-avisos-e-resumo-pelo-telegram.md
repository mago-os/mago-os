# 0037 Avisos e resumo do dia pelo Telegram

- **Data:** 22/11/2026
- **Situação:** proposta (aguardando o "aprovado" do Sandro)
- **Tarefa:** M5-08

## Contexto

Os avisos (M3-06) chegam no sino e no push. O plano pede que o urgente também chegue no Telegram e que o resto vire um resumo do dia, para não virar ruído. Decisões 7 e 8 da spec do M5, aprovadas em 22/11/2026.

## Decisão

1. **Canal novo nas preferências.** Ao lado do sino e do push, cada tipo de aviso ganha a coluna Telegram em Meu perfil › Notificações. Ela só vale para quem tem o Telegram vinculado na empresa.
2. **O padrão é só o urgente.** Vão na hora, por padrão: menção, precisa de ajuda, prazo vencido e agentes parados. O resto fica desligado no Telegram e entra no resumo do dia. Cada pessoa liga ou desliga cada tipo.
3. **O que nunca vai como aviso pelo Telegram:** o pedido de aprovação (ele já chega com os botões, M5-04) e os avisos sobre o próprio Telegram (vínculo tirado e aprovações travadas).
4. **Silêncio.** No horário de silêncio da pessoa, o aviso pelo Telegram espera o fim, como o push. O sino recebe na hora.
5. **Resumo do dia.** Ligado por padrão às 8h, no fuso da pessoa, com hora ajustável ou desligado. Traz as prioridades de hoje (a mesma lista da central, até 10, com o link de cada uma) e quantos avisos ainda não foram lidos. Vai uma vez por dia; num dia sem nada, vai a frase "Nada pedindo a sua atenção hoje". No silêncio, espera o fim dele.
6. **Entrega.** Todo aviso novo fica marcado para o Telegram. A verificação a cada minuto confere o canal, o vínculo e o silêncio, manda e desmarca. O aviso que não foi em 12 horas desiste (fica no sino e no push). O texto é o do aviso, mais o link para abrir no app, só como texto.
7. **Cada empresa por si.** O aviso vai pelo Telegram só se o vínculo do Telegram é da mesma empresa do aviso; avisos de outra empresa da pessoa ficam no sino daquela empresa. O resumo do dia é da empresa do Telegram.

## O que foi descartado

- **Tudo o que vai para o push vai também para o Telegram:** num dia de muito trabalho, o Telegram vira ruído e a pessoa desliga o bot.
- **Avisos de todas as empresas da pessoa no mesmo Telegram:** mistura dados de empresas na mesma conversa; o seletor com os avisos de todas as empresas é da Fase 2.

## Consequências

- Contratos: `telegram` em `CanaisDoAviso`, `resumoDoDia` nas preferências, `AVISOS_URGENTES_NO_TELEGRAM`, `AVISOS_FORA_DO_TELEGRAM`, `canaisDoTipo` e `horaDoResumo` em `contratos/src/avisos/notificacoes.ts`; o texto do aviso e o prazo de 12 horas em `contratos/src/canais/telegram.ts`.
- Banco: `avisos.telegram_pendente` e `vinculos_do_telegram.resumo_do_dia_em` (o último dia em que o resumo foi).
- Pronto quando: uma menção ao Sandro chega no Telegram na hora, e às 8h chega o resumo do dia.
