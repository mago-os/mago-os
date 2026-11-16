# 0006 SSH da VPS02: só com chave, porta 22 aberta enquanto dividir com a Ratoeira

- **Data:** 16/11/2026
- **Situação:** aceita (rever quando o Mago OS tiver VPS própria)
- **Tarefa:** M0-09
- **Decidido por:** Sandro, por escrito no chat ("aprovo os passos 1 a 5 da M0-09 na VPS02")

## Contexto

O plano pede administração só por chave e pela rede privada (Tailscale). A VPS02 aceitava root e senha pela internet. A Ratoeira, que divide a máquina, mantém a porta 22 aberta de propósito: é por ela que o agente do computador da pessoa entra como root para socorrer a VPS.

## Decisão

1. Usuário próprio `mago-admin` (só chave, `sudo` sem senha) para administrar o Mago OS; o root fica para emergências.
2. Senha desligada no SSH e root só com chave, pela receita `ssh-so-chave` da própria Ratoeira.
3. Tailscale na VPS02 e no Mac do Sandro, como caminho preferido de administração.
4. A porta 22 segue aberta na internet, só com chave e com fail2ban, para não quebrar o socorro da Ratoeira.

## Descartado

- **Fechar a porta 22 e deixar o SSH só no Tailscale:** quebraria o socorro da Ratoeira. Fica para quando o Mago OS tiver VPS própria.
- **Trocar a porta do SSH:** não protege de verdade e confundiria a Ratoeira.

## Consequências

- Muda a subtarefa da spec "SSH só por chave, pela rede privada": por chave, sim; só pela rede privada, não por enquanto.
- O acesso de administração está em `docs/operacao/acesso-vps.md`.
