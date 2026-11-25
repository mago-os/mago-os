# Infraestrutura da produção na VPS02 (app.osmago.com)

Montada no M6-05 (decisão 0044), ao lado do teste e separada dele. Por decisão do Sandro (24/11/2026), a produção
roda na própria VPS02 até ele tirar a Ratoeira e o teste de lá; quando precisar de mais recurso, a VPS02 ganha CPU,
memória ou disco. Nenhum arquivo aqui tem senha: os segredos ficam no Infisical, no projeto **mago-os-producao**
(ambiente Production), que só a identidade `vps02-producao` lê.

## O que fica separado do teste

| Coisa | Teste | Produção |
| --- | --- | --- |
| Pasta | `/opt/mago-os` | `/opt/mago-os-producao` |
| Projeto do compose (e prefixo dos containers, redes e volumes) | `mago-os` | `mago-os-producao` |
| Banco, antivírus e volumes | `mago-os-db-1`, `mago-os-clamav-1` | `mago-os-producao-db-1`, `mago-os-producao-clamav-1` |
| API (azul e verde, só em 127.0.0.1) | 3101 e 3102 | 3201 e 3202 |
| Imagem que a VPS baixa | `ghcr.io/mago-os/mago-os:teste` | `ghcr.io/mago-os/mago-os:producao` |
| Quem publica | cada merge na main (campainha e timer) | só a versão que o Sandro aprova no GitHub (timer a cada minuto) |
| Caddy | `/etc/caddy/mago-os.caddy` | `/etc/caddy/mago-os-producao.caddy` (só pedidos da Cloudflare) |
| Telas | `/srv/mago-os/telas` | `/srv/mago-os-producao/telas` |
| Segredos | Infisical `mago-os`, Staging, identidade `vps02` | Infisical `mago-os-producao`, Production, identidade `vps02-producao` |
| Backblaze | `mago-os-backup`, `mago-os-anexos-teste`, `mago-os-auditoria` | `mago-os-producao-backup`, `mago-os-producao-anexos`, `mago-os-producao-auditoria` |
| Registros | `/var/log/mago-os-*.log` | `/var/log/mago-os-producao-*.log` |

Os scripts de `bin/` são os mesmos do teste (`infra/vps02/bin`): cada um lê o `ambiente.conf` da própria pasta e,
sem ele, usa os padrões do teste.

| Arquivo aqui | Onde fica no servidor |
| --- | --- |
| `ambiente.conf` | `/opt/mago-os-producao/ambiente.conf` (com o id do projeto do Infisical preenchido) |
| `compose.yaml` | `/opt/mago-os-producao/compose.yaml` |
| `../vps02/bin/*.sh` | `/opt/mago-os-producao/bin/` |
| `../vps02/db-image/Dockerfile` | imagem `mago-os-db:pg18` (a mesma do teste) |
| `pgbackrest/pgbackrest.conf` | `/opt/mago-os-producao/pgbackrest/pgbackrest.conf` |
| `caddy/mago-os-producao.caddy.modelo` | `/opt/mago-os-producao/caddy/mago-os-producao.caddy.modelo` |
| `systemd/*` | `/etc/systemd/system/` |
| `cron/mago-os-producao` | `/etc/cron.d/mago-os-producao` |

## Montar do zero (ou numa VPS nova)

1. `install -d -m 755 /opt/mago-os-producao/{bin,caddy,pgbackrest,estado} /srv/mago-os-producao/telas` e copiar os
   arquivos para os caminhos da tabela (`bin/` com `chmod 755`).
2. Criar só o `/opt/mago-os-producao/infisical.env` (`chmod 600`), com `INFISICAL_CLIENT_ID` e
   `INFISICAL_CLIENT_SECRET` da identidade `vps02-producao`. É a única coisa que não está no repositório nem no
   backup: numa VPS nova (a antiga perdida ou invadida), o Sandro gera um client secret novo da identidade no
   Infisical (projeto mago-os-producao › Access Control › Identities › vps02-producao › Universal Auth) e apaga o
   antigo.
3. `/opt/mago-os-producao/bin/segredos.sh` (grava `.env`, `backup.env`, `api.env`, `auditoria.env`, `avisos.env`).
4. Se a imagem do banco ainda não existir: `docker build -t mago-os-db:pg18 /opt/mago-os/db-image`.
5. `cd /opt/mago-os-producao && docker compose up -d` e, no primeiro uso,
   `docker compose exec -u postgres db pgbackrest --stanza=mago stanza-create` (para restaurar, ver backup.md).
6. Criar o arquivo vazio `/etc/caddy/mago-os-producao.caddy` (`touch`; o `publicar.sh` escreve nele na primeira
   publicação), acrescentar `import /etc/caddy/mago-os-producao.caddy` ao fim do Caddyfile, conferir com
   `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, `systemctl reload caddy` e
   `systemctl daemon-reload && systemctl enable --now mago-os-producao-publicar.timer mago-os-producao-auditoria-copia.timer`.
7. A primeira publicação acontece quando o Sandro aprovar a versão no GitHub (docs/operacao/producao.md).

## Ensaio de desastre (M6-03)

`ensaio-remontagem.sh` remonta a produção do zero numa pasta e em containers à parte (`/opt/mago-os-ensaio`,
projeto `mago-os-ensaio`), seguindo os passos acima, só com o repositório, o Infisical e o backup do Backblaze. Mede
o tempo de cada passo e quantos dados se perderiam, compara as contagens com a produção, confere a auditoria contra a
cópia travada e confere que um anexo apagado volta (um arquivo de teste é enviado, apagado e trazido de volta pela
versão que o depósito guarda por 30 dias). No fim, apaga tudo o que criou. Não toca na produção, no Caddy nem na
Ratoeira: a API do ensaio sobe sem internet e sem as chaves do Telegram, do e-mail, do push, do Google, dos anexos e
do Grafana, e o banco do ensaio não envia nada para o depósito.

```bash
# No Mac, na pasta do repositório (main atualizada):
git archive --format=tar main | ssh mago-vps02 'rm -rf /tmp/fonte && mkdir /tmp/fonte && tar -x -C /tmp/fonte'
ssh mago-vps02 'sudo bash /tmp/fonte/infra/producao/ensaio-remontagem.sh /tmp/fonte | sudo tee /root/ensaio-$(date -u +%F).log'
```

O ensaio não cobre a troca do Caddy e do DNS (passos 6 e 7 numa VPS nova): numa VPS nova, a primeira publicação
(`publicar.sh forcar`) escreve o Caddy e as telas em poucos minutos, e o registro A de app.osmago.com na Cloudflare
passa a apontar para o IP novo (com o ok escrito do Sandro).

| Data | Tempo até a API no ar (sem DNS) | Dados perdidos | Resultado |
| --- | --- | --- | --- |
| 25/11/2026, 14h39 UTC | 26 s (ensaio inteiro em 34 s) | 3 min 36 s (a última alteração no backup era das 14h36m10s; o diário de alterações vai para o Backblaze pelo menos a cada 5 minutos) | Contagens iguais às da produção, auditoria íntegra (2 correntes, 20 eventos), anexo apagado voltou. A produção ainda tem pouco dado (1 empresa, sem tarefas nem anexos): o tempo cresce com o banco. Uma correção no script (o ambiente precisa ser `producao`); nenhuma no manual além da credencial do Infisical (passo 2) |

Repetir a cada 6 meses (cartão no quadro) e sempre que a montagem da produção mudar.

Ao mudar algo no servidor, atualizar a cópia aqui no mesmo dia.
