# Produção (app.osmago.com)

Estado em 25/11/2026 (M6-05). Como publicar, voltar e ver o estado da produção. A montagem do servidor está em
[infra/producao/README.md](../../infra/producao/README.md); o porquê, na decisão 0044.

## Publicar uma versão

A produção só recebe uma versão que já está no teste, e só com o clique do Sandro.

1. Conferir a versão no teste (teste.osmago.com).
2. GitHub › Actions › **Publicação na produção** › **Run workflow**. Sem preencher nada, vai a versão que está no
   teste agora; para outra, colar o commit (sha completo, que precisa estar na main e já ter passado pelo teste).
3. O GitHub pede a aprovação do Sandro (ambiente `producao`): e-mail e app do GitHub, botão **Approve and deploy**.
4. Aprovado, o fluxo marca a imagem como `:producao`. Em até 1 minuto, a VPS02 (`mago-os-producao-publicar.timer`):
   - faz uma cópia do banco (backup incremental no Backblaze); se o backup falhar, não publica;
   - roda as migrações (elas não podem quebrar a versão que está no ar: a verificação de cada PR roda os testes da
     versão anterior contra o banco novo);
   - liga a versão nova ao lado da antiga, confere a saúde, troca o Caddy, confere de novo e só então desliga a
     antiga. Se a nova não ficar saudável, a antiga continua no ar.

Acompanhar: `journalctl -u mago-os-producao-publicar -f` na VPS02.

## Voltar uma versão

```bash
ssh mago-vps02
sudo /opt/mago-os-producao/bin/publicar.sh voltar
```

Volta para a versão anterior (a imagem e as telas das 3 últimas ficam guardadas). As migrações não voltam sozinhas:
como elas são compatíveis com a versão anterior, voltar o código basta. Para desfazer dados, restaurar o backup
([backup.md](backup.md), trocando `/opt/mago-os` por `/opt/mago-os-producao`).

## Ver o estado

| O quê | Como |
| --- | --- |
| Versão no ar | `cat /opt/mago-os-producao/estado/versao` (com o DNS: https://app.osmago.com/api/saude) |
| Histórico de publicações | `/opt/mago-os-producao/estado/historico` (o que foi publicado de fato); GitHub › Releases (`producao-...`) registra as aprovações |
| Containers | `docker ps --filter name=mago-os-producao` |
| Backup | `cd /opt/mago-os-producao && docker compose exec -u postgres db pgbackrest --stanza=mago info` |
| Memória, disco e Backblaze | `/opt/mago-os-producao/bin/recursos.sh` (roda a cada 5 minutos e avisa o monitoramento) |
| Registros e rastreio | Grafana Cloud, ambiente `producao` no painel "Mago OS" ([rastreio.md](rastreio.md)) |

## Até o DNS (M6-05b)

- O Caddy atende app.osmago.com com certificado próprio (`tls internal`) e só aceita pedidos da Cloudflare ou do
  próprio servidor. A conferência local do `publicar.sh` usa `curl -k` (`CURL_EXTRA` no `ambiente.conf`).
- Com o DNS: apagar a linha `tls internal` do modelo do Caddy, tirar `CURL_EXTRA` do `ambiente.conf` e publicar de
  novo (`publicar.sh forcar`).

## Regras

- A VPS02 é dividida com o teste e a Ratoeira: o Caddy só é recarregado, nunca reiniciado; nada da Ratoeira muda.
- Ninguém publica em produção sem a aprovação do Sandro no GitHub (CLAUDE.md).
- Dados reais nunca saem da produção: o teste continua só com dados falsos.
