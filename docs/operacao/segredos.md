# Segredos (Infisical)

Todos os segredos do Mago OS ficam no Infisical Cloud (região EUA, https://app.infisical.com), organização Nolask, projeto `mago-os`. Nenhum segredo fica no repositório: o gitleaks da verificação automática barra o que escapar.

## Ambientes

| Ambiente no Infisical | Ambiente do Mago OS | Quem lê |
| --- | --- | --- |
| Development (`dev`) | Local (Mac e ambiente do Claude) | Por enquanto ninguém: o ambiente local não tem senha |
| Staging (`staging`) | Teste (teste.osmago.com, VPS02) | Identidade `vps02` (só leitura) |
| Production (`prod`), no projeto **`mago-os-producao`** | Produção (app.osmago.com, M6-05) | Identidade `vps02-producao` (só leitura, só deste projeto) |

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
| `MAGO_RESEND_CHAVE` | Chave do Resend só de envio (domínio `osmago.com`), começa com `re_`. Opcional fora da produção: sem ela, os links de senha e de convite vão para o log | API, e-mails de convite e de senha (M1-07) |
| `MAGO_TELEGRAM_TOKEN` | Token do bot de teste do Telegram, criado pelo Sandro no @BotFather e colado por ele na web do Infisical. Opcional: sem ele, o Telegram fica desligado. Trocar: /revoke no BotFather e gravar o novo | API, bot do Telegram (M5-01) |
| `MAGO_TELEGRAM_SEGREDO` | Segredo que o Telegram manda em cada chamada do webhook (48 caracteres, gerado com `openssl rand -hex 24`). Trocar: gravar o novo e reiniciar a API, que registra o webhook de novo | API, webhook do Telegram (M5-01) |
| `GRAFANA_OTLP_ENDPOINT` | Endereço OTLP do Grafana Cloud (Grafana Cloud › a stack › OpenTelemetry › Configure), colado pelo Sandro na web do Infisical. Opcional: sem os três do Grafana, nada sai do servidor | API, rastreio e registros (M6-02) |
| `GRAFANA_OTLP_INSTANCIA` | Número da instância (Instance ID) da mesma tela | API, rastreio e registros (M6-02) |
| `GRAFANA_OTLP_TOKEN` | Token do Grafana Cloud só de escrita (Access Policy com `traces:write`, `logs:write` e `metrics:write`). Trocar: criar outro token, gravar, rodar o `segredos.sh` e `publicar.sh forcar`, e só então apagar o antigo | API, rastreio e registros (M6-02) |
| `GRAFANA_API_TOKEN` | Token da conta de serviço `claude-mago` (papel Admin) do Grafana Cloud, criado pelo Sandro. Usado só no Mac pelo `infra/grafana/montar.py` (painel e alertas), nunca no servidor. Trocar: gerar outro token na mesma conta de serviço, gravar e apagar o antigo | Mac, montagem do Grafana (M6-02) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET` | Acesso ao bucket de backup no Backblaze B2 | pgBackRest |
| `PGBACKREST_CIPHER_PASS` | Senha de criptografia dos backups. Sem ela, nenhum backup pode ser restaurado | pgBackRest |
| `MAGO_CAMPAINHA_SEGREDO` | Assinatura da campainha de publicação (também em GitHub › Settings › Secrets) | Campainha na VPS e fluxo de publicação |
| `MAGO_AVISO_BACKUP`, `MAGO_AVISO_RESTAURACAO`, `MAGO_AVISO_AUDITORIA` | Endereços "push" do Uptime Kuma (VPS01) | `bin/avisar.sh`, ver [monitoramento.md](monitoramento.md) |
| `B2_AUDITORIA_KEY_ID`, `B2_AUDITORIA_APPLICATION_KEY` | Chave própria do depósito travado `mago-os-auditoria` (só ele, leitura e escrita) | `auditoria-copia.sh` e `auditoria-verificar.sh`, ver [auditoria.md](auditoria.md) |
| `GHCR_LEITURA_TOKEN` | Token "classic" do Sandro (`mago-os-vps02-baixar-imagem`), só `read:packages`, **sem vencimento**: trocar em qualquer suspeita de vazamento (apagar em github.com/settings/tokens e gravar o novo no Infisical) | A VPS baixar a imagem do ghcr.io |

## Segredos da produção (projeto `mago-os-producao`, ambiente Production)

Gerados em 25/11/2026 (M6-05) pelo `claude-mac` com `infisical-gravar.py prod NOME` (o "prod" grava no projeto da
produção): `MAGO_DB_SENHA_DONO`, `MAGO_DB_SENHA_APP`, `MAGO_DB_SENHA_ACESSO`, `MAGO_ACESSO_SEGREDO`,
`MAGO_COFRE_CHAVE_MESTRA`, `PGBACKREST_CIPHER_PASS` (reserva no Mac em
`~/Credenciais/Nolask/Clientes/MagoOS/pgbackrest-cipher-pass-mago-os-producao.txt`: **sem ela, nenhum backup da
produção pode ser restaurado**), `MAGO_VAPID_PUBLICA` e `MAGO_VAPID_PRIVADA` (par novo, só da produção). Copiados do
teste, por enquanto: `GHCR_LEITURA_TOKEN` (o mesmo token de leitura das imagens) e os três `GRAFANA_OTLP_*` (a mesma
conta do Grafana; o ambiente vai em cada registro). Criados pelo Sandro no Backblaze: `B2_*`, `B2_ANEXOS_*` e
`B2_AUDITORIA_*` dos três buckets da produção. Na M6-05b: o bot do Telegram, o cliente do Google, o Resend e os
endereços do Uptime Kuma (`MAGO_AVISO_*`).

## Como os segredos chegam à VPS

1. `/opt/mago-os/bin/segredos.sh` entra no Infisical com a identidade `vps02`, grava `.env`, `backup.env`, `api.env` e `campainha.env` em `/opt/mago-os` e entra no ghcr.io, só para o root ler. Nenhum valor aparece na tela nem no log.
2. Os containers leem esses arquivos quando são criados: depois de trocar um segredo, rodar o script e recriar o container (`docker compose up -d --force-recreate <serviço>`).

## Criar ou trocar um segredo

No Mac, com a identidade `claude-mac`, o valor entra pela entrada padrão e nunca aparece na tela:

```bash
openssl rand -base64 32 | python3 -I infra/ferramentas/infisical-gravar.py staging NOME_DO_SEGREDO
```

Trocar a senha de um papel do banco exige também mudar a senha no PostgreSQL (`ALTER ROLE ... PASSWORD`) antes de recriar os containers. Para `mago_app` e `mago_acesso`, o `publicar.sh` já faz isso a cada publicação: basta rodar `segredos.sh` e depois `publicar.sh forcar`. O passo a passo completo de troca de chaves entra no manual junto com a publicação (M0-10).
