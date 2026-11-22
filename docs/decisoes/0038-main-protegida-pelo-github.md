# 0038 Main protegida pelo GitHub

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026, "pode ligar"); substitui a [0005](0005-main-sem-trava-por-enquanto.md)
- **Tarefa:** M0-07
- **Decidido por:** Sandro

## Contexto

A [decisão 0005](0005-main-sem-trava-por-enquanto.md) deixou a main sem a trava do GitHub, com a regra só escrita, porque num repositório privado a proteção pedia o plano pago. Em 22/11/2026 o Sandro deixou o repositório `mago-os/mago-os` público (para o GitHub Actions não ter limite de minutos sem pagar nada), e com isso a proteção ficou grátis.

## Decisão

Uma regra do GitHub (ruleset "Proteção da main", na branch padrão) ligada:

1. **Só entra por PR.** Ninguém envia direto para a main, nem os agentes.
2. **Verificação verde e em dia.** O merge fica bloqueado até os três trabalhos da verificação ("Tipos, estilo e testes", "Testes de tela" e "Segurança") passarem, com o PR atualizado com a main (se a main andou, o PR recebe a main e a verificação roda de novo).
3. **A main não se apaga nem tem o histórico reescrito** (sem force push).
4. **Sem aprovação obrigatória no GitHub.** O GitHub não deixa o Sandro aprovar um PR aberto pela própria conta; o "ok" dele no chat continua sendo a aprovação, como antes.
5. **Emergência:** os administradores da organização podem passar por cima da regra só dentro de um PR (nunca com envio direto). Ninguém usa isso sem o pedido do Sandro.

## Descartado

- **Seguir só com a regra escrita:** a trava agora é grátis e protege contra erro de configuração de um agente ou acesso indevido.
- **Exigir aprovação no GitHub:** travaria todo merge, porque os PRs saem pela conta do Sandro.
- **Sem a exigência de estar em dia com a main:** dois PRs verdes cada um sozinho podem quebrar a main juntos; com uma tarefa por vez, o custo é pequeno.

## Consequências

- A regra combinada do AGENTS.md e do CLAUDE.md continua, agora com a trava do GitHub por trás.
- A proteção da main da M0-07 fica feita na spec.
- O que a trava confere está em `docs/operacao/verificacao.md`.
