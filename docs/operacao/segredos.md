# Segredos (Infisical)

Todos os segredos do Mago OS ficam no Infisical Cloud (região EUA, https://app.infisical.com), organização Nolask, projeto `mago-os`. Nenhum segredo fica no repositório: o gitleaks da verificação automática barra o que escapar.

## Ambientes

| Ambiente no Infisical | Ambiente do Mago OS | Quem lê |
| --- | --- | --- |
| Development (`dev`) | Local (Mac e ambiente do Claude) | Por enquanto ninguém: o ambiente local não tem senha |
| Staging (`staging`) | Teste (teste.osmago.com, VPS02) | Identidade `vps02` (só leitura) |
| Production (`prod`) | Produção (app.osmago.com, M6) | A definir no M6 |

## Identidades

| Identidade | Papel | Para quê | Credenciais |
| --- | --- | --- | --- |
| `vps02` | Viewer | A VPS02 lê os segredos de teste | `/opt/mago-os/infisical.env` e reserva no Mac em `~/Credenciais/Nolask/Clientes/MagoOS/infisical-mago-os-vps02.env` |
| `claude-mac` | Member | O Claude cria e troca segredos | `~/Credenciais/Nolask/Clientes/MagoOS/infisical-mago-os-claude.env` (só no Mac) |

## Segredos de teste (staging)

| Nome | O que é | Quem usa |
| --- | --- | --- |
| `MAGO_DB_SENHA_DONO` | Senha do papel `mago`, dono das tabelas | Container do banco e migrações |
| `MAGO_DB_SENHA_APP` | Senha do papel `mago_app`, usado pela API | API (a partir do M0-10) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET` | Acesso ao bucket de backup no Backblaze B2 | pgBackRest |
| `PGBACKREST_CIPHER_PASS` | Senha de criptografia dos backups. Sem ela, nenhum backup pode ser restaurado | pgBackRest |
| `MAGO_CAMPAINHA_SEGREDO` | Assinatura da campainha de publicação (também em GitHub › Settings › Secrets) | Campainha na VPS e fluxo de publicação |
| `GHCR_LEITURA_TOKEN` | Token "classic" do Sandro, só `read:packages`, vence em 1 ano | A VPS baixar a imagem do ghcr.io |

## Como os segredos chegam à VPS

1. `/opt/mago-os/bin/segredos.sh` entra no Infisical com a identidade `vps02`, grava `.env`, `backup.env`, `api.env` e `campainha.env` em `/opt/mago-os` e entra no ghcr.io, só para o root ler. Nenhum valor aparece na tela nem no log.
2. Os containers leem esses arquivos quando são criados: depois de trocar um segredo, rodar o script e recriar o container (`docker compose up -d --force-recreate <serviço>`).

## Criar ou trocar um segredo

No Mac, com a identidade `claude-mac`, o valor entra pela entrada padrão e nunca aparece na tela:

```bash
openssl rand -base64 32 | python3 -I infra/ferramentas/infisical-gravar.py staging NOME_DO_SEGREDO
```

Trocar a senha de um papel do banco exige também mudar a senha no PostgreSQL (`ALTER ROLE ... PASSWORD`) antes de recriar os containers. O passo a passo completo de troca de chaves entra no manual junto com a publicação (M0-10).
