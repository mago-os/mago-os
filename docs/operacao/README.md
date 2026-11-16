# Manual de operação

Como publicar, voltar uma versão, restaurar o backup, trocar chaves e o que fazer se o sistema cair. Escrito à mão e testado na prática.

| Assunto | Onde está hoje | Entra em |
| --- | --- | --- |
| Quadro de tarefas (colunas, campos e automações) | [quadro.md](quadro.md) | Já existe |
| Verificação automática no GitHub (o que roda e o que fazer se falhar) | [verificacao.md](verificacao.md) | Já existe |
| Acesso de administração à VPS02 (usuários, SSH, Tailscale, firewall) | [acesso-vps.md](acesso-vps.md) | Já existe |
| Infraestrutura da VPS02 e como remontar do zero | [infra/vps02/README.md](../../infra/vps02/README.md) | Já existe |
| Backup e restauração do banco (B2) | [backup.md](backup.md) | Já existe |
| Publicar e voltar uma versão no teste | [publicacao.md](publicacao.md) | Já existe |
| Segredos: ambientes, identidades e como criar ou trocar | [segredos.md](segredos.md) | Já existe |
| Monitoramento e o que fazer se cair | [monitoramento.md](monitoramento.md) | Já existe |

## Regras que valem sempre

- A VPS02 é dividida com a Ratoeira, que roda direto no servidor (fora de container). Nunca derrubar, reiniciar ou mudar algo dela. O Caddy é recarregado (`systemctl reload caddy`), nunca reiniciado.
- A VPS nunca recebe código à mão: só baixa do GitHub o pacote pronto e aprovado.
- Mudanças de DNS só com aprovação escrita do Sandro.
- Segredos só no Infisical e, no servidor, em arquivos que só o root lê. Nunca em arquivo versionado.
