# Monitoramento (Uptime Kuma)

Criado na M0-12, em 16/11/2026. O Mago OS usa o Uptime Kuma que o Sandro já tinha na **VPS01** (https://uptimekuma.nolask.com), de propósito numa máquina diferente da VPS02: se a VPS02 cair inteira, o Kuma percebe e avisa. Os avisos vão para o Telegram do Sandro (notificação "Telegram 01", já configurada no Kuma).

## O que é vigiado

| Vigia no Kuma | Tipo | O que confere | Quando avisa |
| --- | --- | --- | --- |
| Mago OS (teste): API | HTTP com palavra-chave | `https://teste.osmago.com/api/saude` responde com `"situacao":"ok"` (API e banco no ar), a cada minuto | Duas falhas seguidas (uns 2 minutos) |
| Mago OS (teste): tela | HTTP com palavra-chave | `https://teste.osmago.com` responde com o título "Mago OS", a cada minuto | Duas falhas seguidas |
| Mago OS: backup diário | Push | O `backup.sh` da VPS02 avisa "ok" ou "falha" | Falha, ou nenhum aviso em 26 horas |
| Mago OS: teste de restauração | Push | O `restauracao-teste.sh` da VPS02 avisa "ok" ou "falha" (toda segunda-feira) | Falha, ou nenhum aviso em 8 dias |

Os endereços "push" ficam no Infisical (`MAGO_AVISO_BACKUP` e `MAGO_AVISO_RESTAURACAO`), e o `segredos.sh` grava `/opt/mago-os/avisos.env` na VPS02. O `bin/avisar.sh` usa esse arquivo.

O teste de restauração passou de mensal para semanal porque o Kuma não aceita prazo maior que 24 dias para um vigia "push". Também ficou mais seguro e custa poucos segundos.

## Provado na prática

Em 16/11/2026, às 23:51 (horário de Lisboa), a API do teste foi parada de propósito. Às 23:53 o Kuma marcou "caiu" e mandou o aviso. A API foi religada às 23:54, e às 23:55 o Kuma marcou "voltou".

## Quando chegar um aviso

1. Abrir https://teste.osmago.com/api/saude: diz se o problema é a API ou o banco.
2. Na VPS02 (`ssh mago-vps02`, `sudo -i`): `docker ps` e `docker logs --tail 50 mago-os-api-$(cat /opt/mago-os/estado/cor)`.
3. Se uma publicação nova quebrou: `/opt/mago-os/bin/publicar.sh voltar` (ver [publicacao.md](publicacao.md)).
4. Aviso de backup: `tail -50 /var/log/mago-os-backup.log` e o manual [backup.md](backup.md).

## Mudar os vigias

Pela tela do Kuma (login do Sandro). Os vigias do Mago OS começam com "Mago OS". A Ratoeira e os sites da 4xpert também estão no mesmo Kuma: não mexer nos vigias deles.
