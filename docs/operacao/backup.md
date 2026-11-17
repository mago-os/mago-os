# Backup e restauração do banco

Estado em 16/11/2026 (M0-11). Explicação para leigos e histórico na Wiki do cliente (página `backup.md`).

## Como funciona

- **pgBackRest** dentro do container do banco (`mago-os-db-1`), stanza `mago`, tudo criptografado (AES-256) antes de sair da VPS02.
- **Backblaze B2**, bucket privado `mago-os-backup`, com três depósitos:

| Depósito | Pasta no bucket | O que guarda | Por quanto tempo |
| --- | --- | --- | --- |
| repo1 | `/pgbackrest` | Cópia completa diária e o diário de alterações (WAL) contínuo | 30 dias, voltando a qualquer momento (perda máxima de uns 5 minutos) |
| repo2 | `/pgbackrest-semanal` | Cópia completa todo domingo | 90 dias, em pontos fixos |
| repo3 | `/pgbackrest-mensal` | Cópia completa todo dia 1 | 1 ano, em pontos fixos |

- **Agendamento** (`/etc/cron.d/mago-os-backup`): backup todo dia às 03:30 UTC (`bin/backup.sh`) e teste de restauração toda segunda-feira às 04:30 UTC (`bin/restauracao-teste.sh`). Registro em `/var/log/mago-os-backup.log`.
- **Avisos:** os dois scripts avisam o monitoramento (`bin/avisar.sh`) com "ok" ou "falha". Se o aviso de "ok" não chegar no prazo, o Uptime Kuma avisa o Sandro (M0-12).
- **Trava (Object Lock) em modo compliance, 30 dias** (ligada em 17/11/2026, decisão do Sandro): todo arquivo gravado no bucket fica lacrado por 30 dias. Ninguém consegue apagá-lo antes disso, nem com a chave da VPS, nem o Sandro, nem o suporte do Backblaze. Protege contra um invasor que tente apagar os backups. Para os arquivos novos, o prazo pode ser mudado ou desligado no painel do Backblaze. Os lacres já aplicados não podem ser soltos antes do prazo.
- **Arquivos apagados no B2:** quando o pgBackRest apaga uma cópia vencida, o B2 a esconde e só a apaga de vez 30 dias depois (regra de ciclo de vida do bucket). Isso dá uma janela para recuperar algo apagado por engano. Um arquivo lacrado só é apagado de verdade depois que o lacre vence.
- **Senha de criptografia:** `PGBACKREST_CIPHER_PASS` no Infisical, com reserva no Mac em `~/Credenciais/Nolask/Clientes/MagoOS/pgbackrest-cipher-pass-mago-os.txt`. **Sem ela, nenhum backup pode ser restaurado.**

## Ver o estado

```bash
ssh mago-vps02
sudo -i
cd /opt/mago-os && docker compose exec -u postgres db pgbackrest --stanza=mago info
```

## Testar a restauração (sem tocar no banco no ar)

```bash
/opt/mago-os/bin/restauracao-teste.sh      # repo1, até o último minuto
/opt/mago-os/bin/restauracao-teste.sh 3    # a cópia mensal mais recente
```

Restaura num container e num volume separados (`mago-os-restauracao-teste`), confere os dados contra o banco no ar e apaga tudo no fim.

## Restaurar de verdade (o banco no ar se perdeu ou corrompeu)

Fazer com calma e, se possível, com o Sandro acompanhando. O teste.osmago.com fica fora do ar durante a restauração.

1. **Parar a publicação e a API**, para ninguém escrever no banco:
   ```bash
   systemctl stop mago-os-publicar.timer mago-os-publicar.path
   docker rm -f mago-os-api-azul mago-os-api-verde
   ```
2. **Parar o banco e guardar os dados atuais** (nunca apagar antes de ter uma restauração boa):
   ```bash
   cd /opt/mago-os && docker compose stop db
   docker run --rm -v mago-os_db-data:/de -v /root:/para alpine tar czf /para/banco-antes-da-restauracao-$(date +%F-%H%M).tar.gz -C /de .
   ```
3. **Restaurar** no volume do banco. Para a cópia mais recente, até o último minuto:
   ```bash
   docker compose run --rm --no-deps -u postgres db pgbackrest --stanza=mago --repo=1 --delta restore
   ```
   Para voltar a um momento exato (antes de um erro, por exemplo), acrescentar `--type=time "--target=2026-11-20 14:30:00+00"`. Para usar uma cópia semanal ou mensal, trocar `--repo=1` por `--repo=2` ou `--repo=3`.
4. **Subir o banco** (`docker compose up -d db`) e conferir que ele abriu: `docker compose exec db psql -U mago -d mago -c 'select count(*) from public.empresas'`.
5. **Fazer uma cópia completa nova** (`/opt/mago-os/bin/backup.sh`) e **religar a publicação**: `/opt/mago-os/bin/publicar.sh forcar` e `systemctl start mago-os-publicar.timer mago-os-publicar.path`.

## Remontar numa VPS nova

Seguir `infra/vps02/README.md`: criar o `infisical.env`, rodar `bin/segredos.sh` e restaurar (passo 3) num volume vazio **antes** de subir o banco pela primeira vez.
