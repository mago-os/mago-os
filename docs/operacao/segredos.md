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
| `MAGO_DB_SENHA_ACESSO` | Senha do papel `mago_acesso`, usado pelo login (só letras e números) | API, parte do login (M1-03) |
| `MAGO_ACESSO_SEGREDO` | Segredo que assina os cookies de sessão (pelo menos 32 caracteres). Trocar derruba todas as sessões | API, parte do login (M1-03) |
| `MAGO_GOOGLE_ID`, `MAGO_GOOGLE_SEGREDO` | ID e chave secreta do cliente OAuth "Mago OS teste" no Google Cloud (ver [acesso.md](acesso.md)). Opcionais: sem eles, só e-mail e senha | API, login com Google (M1-04) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET` | Acesso ao bucket de backup no Backblaze B2 | pgBackRest |
| `PGBACKREST_CIPHER_PASS` | Senha de criptografia dos backups. Sem ela, nenhum backup pode ser restaurado | pgBackRest |
| `MAGO_CAMPAINHA_SEGREDO` | Assinatura da campainha de publicação (também em GitHub › Settings › Secrets) | Campainha na VPS e fluxo de publicação |
| `MAGO_AVISO_BACKUP`, `MAGO_AVISO_RESTAURACAO` | Endereços "push" do Uptime Kuma (VPS01) | `bin/avisar.sh`, ver [monitoramento.md](monitoramento.md) |
| `GHCR_LEITURA_TOKEN` | Token "classic" do Sandro (`mago-os-vps02-baixar-imagem`), só `read:packages`, **sem vencimento**: trocar em qualquer suspeita de vazamento (apagar em github.com/settings/tokens e gravar o novo no Infisical) | A VPS baixar a imagem do ghcr.io |

## Como os segredos chegam à VPS

1. `/opt/mago-os/bin/segredos.sh` entra no Infisical com a identidade `vps02`, grava `.env`, `backup.env`, `api.env` e `campainha.env` em `/opt/mago-os` e entra no ghcr.io, só para o root ler. Nenhum valor aparece na tela nem no log.
2. Os containers leem esses arquivos quando são criados: depois de trocar um segredo, rodar o script e recriar o container (`docker compose up -d --force-recreate <serviço>`).

## Criar ou trocar um segredo

No Mac, com a identidade `claude-mac`, o valor entra pela entrada padrão e nunca aparece na tela:

```bash
openssl rand -base64 32 | python3 -I infra/ferramentas/infisical-gravar.py staging NOME_DO_SEGREDO
```

Trocar a senha de um papel do banco exige também mudar a senha no PostgreSQL (`ALTER ROLE ... PASSWORD`) antes de recriar os containers. Para `mago_app` e `mago_acesso`, o `publicar.sh` já faz isso a cada publicação: basta rodar `segredos.sh` e depois `publicar.sh forcar`. O passo a passo completo de troca de chaves entra no manual junto com a publicação (M0-10).
