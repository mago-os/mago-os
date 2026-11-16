# Manual de operação

Como publicar, voltar uma versão, restaurar o backup, trocar chaves e o que fazer se o sistema cair. Escrito à mão e testado na prática.

| Assunto | Onde está hoje | Entra em |
| --- | --- | --- |
| Infraestrutura da VPS02 e como remontar do zero | [infra/vps02/README.md](../../infra/vps02/README.md) | Já existe |
| Restaurar o backup do banco (B2) | A escrever | M0-11 |
| Publicar e voltar uma versão no teste | A escrever | M0-10 |
| Trocar chaves e segredos (Infisical) | A escrever | M0-08 |
| O que fazer se cair | A escrever | M0-12 |

## Regras que valem sempre

- A VPS02 é dividida com a Ratoeira, que roda direto no servidor (fora de container). Nunca derrubar, reiniciar ou mudar algo dela. O Caddy é recarregado (`systemctl reload caddy`), nunca reiniciado.
- A VPS nunca recebe código à mão: só baixa do GitHub o pacote pronto e aprovado.
- Mudanças de DNS só com aprovação escrita do Sandro.
- Segredos só no Infisical e, no servidor, em arquivos que só o root lê. Nunca em arquivo versionado.
