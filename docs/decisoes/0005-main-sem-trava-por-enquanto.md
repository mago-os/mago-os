# 0005 Main sem trava do GitHub por enquanto

- **Data:** 16/11/2026
- **Situação:** aceita (rever antes de entrar outro agente ou desenvolvedor, ou antes da produção no M6, o que vier primeiro)
- **Tarefa:** M0-07
- **Decidido por:** Sandro

## Contexto

A spec pede a main protegida: só entra por PR, com testes verdes e aprovação. O GitHub só oferece essa proteção em repositório privado com plano pago (Team, US$ 4 por pessoa por mês). Hoje só o Sandro e o Claude mexem no repositório.

## Decisão

Seguir sem a trava do GitHub por enquanto, com o código fechado. Em troca:

1. **Regra escrita no AGENTS.md:** nenhum merge na main sem a verificação ("Tipos, estilo e testes", "Testes de tela" e "Segurança") toda verde. Ninguém envia direto para a main sem PR.
2. **A verificação também roda depois de cada merge, na própria main.** Se algo ficar vermelho, a correção vem antes de qualquer outra tarefa.
3. **Rever esta decisão** antes de entrar outro agente (como o Hermes) ou desenvolvedor, ou antes da produção (M6). Nesse momento, assinar o GitHub Team e ligar a proteção (o que exigir está em `docs/operacao/verificacao.md`).

## Descartado

- **GitHub Team agora:** o Sandro preferiu não pagar neste momento.
- **Repositório público para ganhar a trava de graça:** exporia o código, inclusive login e segurança, antes de estarem prontos.

## Consequências

- A trava é uma regra combinada, não técnica: não protege contra erro de configuração de um agente ou acesso indevido. Por isso o prazo de revisão.
- A M0-07 fica com a proteção da main pendente na spec, ligada a esta decisão.
