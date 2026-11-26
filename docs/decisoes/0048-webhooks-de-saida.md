# 0048 Webhooks de saída

- **Data:** 26/11/2026
- **Situação:** proposta (esperando o ok do Sandro)
- **Tarefa:** M7-03

## Contexto

A spec do M7, aprovada em 25/11/2026, pede avisos para sistemas de fora quando algo acontece no Mago OS. A decisão 5
(tentar por 24 horas com espera crescente e desligar depois de 3 dias de falha, avisando o administrador) já está
aprovada. Esta nota acerta o resto. Os pontos que pedem o olho do Sandro estão marcados com **pede o seu olho**.

## Decisão

1. **Onde.** Uma tela nova, **Webhooks**, ao lado de Chaves de API. Só o administrador cria, muda, desliga e apaga,
   com a mesma permissão das chaves (módulo "api", alcance "tudo"), porque o aviso fala da empresa inteira. Até 10
   webhooks por empresa.
2. **O webhook.** Nome, endereço https e os eventos escolhidos. O endereço precisa ser público: o Mago OS recusa
   localhost e rede interna ao cadastrar e confere de novo, a cada entrega, o IP para onde o nome aponta. Assim
   ninguém usa o webhook para alcançar a rede do próprio servidor.
3. **Segredo.** **Pede o seu olho:** o Mago OS gera o segredo (`whsec_...`) e mostra uma vez só, como as chaves de
   API, com o botão "Trocar segredo". Ele fica guardado cifrado no cofre (decisão 0021), porque o Mago OS precisa
   dele para assinar cada aviso.
4. **Eventos.** Tarefa criada, tarefa concluída, comentário numa tarefa (as notas internas não saem), contato
   cadastrado, contato mudou, aprovação pedida e aprovação respondida. **Pede o seu olho:** "tarefa mudou" conta só
   as mudanças que importam para quem está de fora: título, descrição, status, responsável, prazo, prioridade e
   projeto. Mudanças pequenas (checklist, etiqueta, seguir a tarefa) não geram aviso, para não inundar o n8n.
5. **O que vai no aviso.** Só o tipo, os ids, o status novo e os nomes dos campos que mudaram, nunca o texto.
   Quem precisa do resto busca pela API pública, com a própria chave e o alcance dela. Assim um endereço vazado não
   vaza o conteúdo.
6. **Assinatura.** Cada aviso leva o cabeçalho `mago-assinatura: t=<hora>,v1=<HMAC SHA-256 de "<hora>.<corpo>">`,
   além de `mago-evento` e `mago-entrega` (o número único). Quem recebe confere a assinatura, recusa aviso com mais de
   5 minutos e ignora um número que já recebeu. A documentação da API ganha o exemplo de como conferir.
7. **Entrega.** Pela fila, logo depois da mudança, esperando no máximo 10 segundos pela resposta; vale qualquer
   resposta 2xx, sem seguir redirecionamento. Falhou: tenta de novo depois de 1, 5 e 30 minutos, 2, 6 e 12 horas (7
   tentativas em pouco mais de 20 horas). Depois disso a entrega desiste, mas o webhook continua ligado.
8. **Desligar por falhas.** Se o webhook passa **3 dias** sem nenhuma entrega certa, ele é desligado, e os
   administradores recebem o aviso "webhook desligado" (no sino, no push e por e-mail). Ligar de novo pela tela zera
   a contagem.
9. **Histórico.** A tela mostra as entregas dos últimos 30 dias de cada webhook: o evento, a situação, o código da
   resposta, o tempo e a hora, com o botão "Tentar de novo". O corpo da resposta não é guardado. Há também o botão
   **Mandar teste**, que manda um aviso `webhook.teste` para conferir a ligação.
10. **Isolamento.** Os eventos são gravados na mesma transação da mudança (como as rotinas por evento, decisão
    0040), só para os webhooks ligados da própria empresa, e as tabelas têm `empresa_id` e RLS. O teste de vazamento
    da M6-01 cobre as rotas novas.
11. **Auditoria.** `webhook.criou`, `webhook.editou`, `webhook.trocou_segredo`, `webhook.apagou`,
    `webhook.desligou_por_falhas` e `webhook.reenviou`, sem o segredo e sem o endereço inteiro (só o domínio).

## O que foi descartado

- **Mandar o texto inteiro no aviso:** mais simples para o n8n, mas um endereço vazado vazaria o conteúdo.
- **Segredo escolhido pela pessoa:** costuma ser fraco; o gerado tem 32 bytes aleatórios.
- **Evento para cada pequena mudança:** inundaria quem recebe; dá para pedir mais eventos depois.

## Consequências

- Contratos: `contratos/src/api/webhooks.ts` (webhook, pedidos, eventos, corpo do aviso, cabeçalhos, esperas,
  entrega e as ações de auditoria); aviso novo `webhook_desligado`.
- Banco: `webhooks` (segredo cifrado), `entregas_de_webhook` (fila e histórico, 30 dias) e os gatilhos que gravam os
  eventos.
- Telas: Webhooks (criar, ver o segredo uma vez, trocar, desligar, apagar, mandar teste, histórico e tentar de novo).
- Pronto quando: o n8n recebe o aviso assinado quando uma tarefa é concluída, um aviso repetido tem o mesmo número,
  um endereço que não responde por 3 dias é desligado com aviso ao administrador, e uma empresa nunca recebe evento de
  outra.
