# 0028 Custo de cada chamada ao modelo e tetos de gasto por mês

- **Data:** 21/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 21/11/2026; item 3 pela recomendação)
- **Tarefa:** M4-06

## Contexto

Os agentes internos já guardam qual modelo rodou, mas não quanto custou. O teto mensal da conta de IA existe na tela desde a M4-01, mas ninguém confere. A M4-06 mede o custo de cada chamada e para o agente antes de passar do teto (decisão 10 da spec do M4).

## Decisão

1. **Cada chamada ao modelo vira um registro** (tabela `consumo_de_ia`): execução, agente, conta, modelo, tokens de entrada, saída e cache, e o custo em microdólares. A conta por assinatura conta os tokens com custo zero (como já decidido na M4-10).
2. **Preço:** uma tabela de preços de referência no código, pelo começo do nome do modelo (Claude Opus, Sonnet e Haiku; GPT-5 e as versões mini e nano; DeepSeek), atualizada por nós. Quando estiver desatualizada, o administrador dá o preço daquele modelo na conta de IA, e ele vale no lugar da referência.
3. **Modelo sem preço** (nem de referência nem do administrador, por exemplo um modelo novo do OpenRouter): o custo usa o maior preço da tabela. Assim o teto continua protegendo, e o painel avisa "sem preço, dê o preço na conta de IA". Alternativa: não deixar usar modelo sem preço (mais chato no dia a dia).
4. **Três tetos por mês:** empresa, agente e conta de IA (este já existe). Padrão para as empresas novas e as que já existem: **US$ 50 na empresa e US$ 20 por agente**, como sugerido na spec; a conta continua sem teto até o administrador pôr. O mês segue o fuso da empresa.
5. **Conferência antes de cada execução:**
   - Aos **80%** de qualquer teto, um aviso uma vez por mês: o do agente vai ao responsável por ele; o da empresa e o da conta, aos administradores.
   - Aos **100%**, a execução não começa: na conversa, a pessoa lê que o agente parou no teto; numa tarefa, ela vai para "precisa de ajuda" com um comentário explicando; e o responsável recebe o aviso. Se só a conta do modelo principal estourou e há um reserva em outra conta, o agente segue pelo reserva.
   - Uma execução que já começou termina (no máximo 30 rodadas), então pode passar um pouco do teto. Conferir a cada rodada fica para a M4-08 (limites por execução).
6. **Plano de assinatura** (pedido do Sandro em 21/11/2026): não tem teto em dólar, porque não cobra por uso. Tem um **limite em tokens por mês** na conta, e o administrador escolhe o que acontece: **só avisar** (padrão: aviso aos 80% e aos 100%, sem bloquear, porque o próprio provedor para o agente quando o limite do plano acaba) ou **avisar e parar** (aviso aos 80% e, aos 100%, a conta deixa de ser usada no mês: o agente passa ao reserva, se houver, ou não começa, como no teto em dólar).
7. **Painel de custos** (Agentes › Custos, do administrador): o mês, com hoje em destaque, por agente, por conta e por dia; e os tetos editáveis ali mesmo.
8. **Agentes externos** (o Claude no Mac, o Hermes) não usam as contas de IA do Mago OS: não entram no custo nem nos tetos.
9. **Quem mexe:** ver o painel, mudar tetos e preços segue o módulo "Contas de IA" (administrador por padrão). Auditoria: `custos.mudou_teto`, `custos.mudou_aviso_de_tokens`, `custos.mudou_preco` e `agente.parou_no_teto`.

## Ponto decidido (item 3)

- **Recomendado e adotado:** modelo sem preço conta pelo maior preço da tabela, e o painel avisa.
- **Alternativa:** modelo sem preço não pode ser usado até o administrador dar o preço.

## Consequências

- Contrato novo em `contratos/src/agentes/custos.ts`; aviso novo `teto_de_gasto`.
- Banco: `consumo_de_ia`, `tetos_de_gasto` (empresa e agente), o aviso em tokens em `contas_de_ia`, o preço do administrador em `modelos_de_conta_de_ia`, e o registro dos avisos já mandados no mês.
- Pronto quando: o Sandro vê quanto o coordenador gastou hoje, e um teto baixo de teste para o especialista antes de ele começar.
