# Auditoria

Como cuidar da auditoria no teste (M1-09). O porquê está na [decisão 0014](../decisoes/0014-auditoria.md).

- **Cópia travada:** `/opt/mago-os/bin/auditoria-copia.sh`, a cada 5 minutos (`mago-os-auditoria-copia.timer`), manda os eventos novos para o depósito `mago-os-auditoria` no Backblaze (compliance, 365 dias). Log em `/var/log/mago-os-auditoria.log`. Sem as chaves (`/opt/mago-os/auditoria.env`), o script não faz nada.
- **Verificação:** todo dia às 05:00 UTC (cron `mago-os-backup`). Para rodar na hora: `ssh vps02 /opt/mago-os/bin/auditoria-verificar.sh`. "Auditoria íntegra" no log quer dizer que todas as correntes fecham e batem com a cópia.
- **Se a verificação falhar:** não apague nada. O log mostra a corrente e a posição do problema. Compare o evento do banco com o da cópia (`eventos/AAAA/MM/DD/*.jsonl` no depósito) e trate como incidente de segurança: alguém mexeu no banco por fora do sistema.
- **Consultar os eventos de uma empresa:** pela rota `GET /api/empresa/auditoria` (administrador) ou, como dono, no banco: `select sequencia, acao, ator, ocorrido_em from auditoria.eventos where empresa_id = '...' order by sequencia desc limit 50;`
- **Instalar na VPS02 (uma vez):** copiar `infra/vps02/bin/auditoria-*.sh` para `/opt/mago-os/bin/`, os `systemd/mago-os-auditoria-copia.*` para `/etc/systemd/system/` (`systemctl enable --now mago-os-auditoria-copia.timer`), o cron atualizado para `/etc/cron.d/mago-os-backup`, e rodar `segredos.sh` depois de criar no Infisical `B2_AUDITORIA_KEY_ID` e `B2_AUDITORIA_APPLICATION_KEY`.
