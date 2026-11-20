# Anexos: depósito, antivírus e o que fazer se algo falhar

Como funciona: [decisão 0020](../decisoes/0020-anexos.md). Resumo: o navegador envia direto para o bucket do Backblaze
(quarentena), a fila passa cada arquivo pelo ClamAV e só o limpo fica disponível.

## Onde fica cada coisa

| O quê | Onde |
| --- | --- |
| Bucket do teste | `mago-os-anexos-teste` (Backblaze B2, conta gratuita), privado, criptografado, só a última versão |
| Chave do bucket | Infisical, ambiente staging: `B2_ANEXOS_ENDPOINT`, `B2_ANEXOS_BUCKET`, `B2_ANEXOS_KEY_ID`, `B2_ANEXOS_APPLICATION_KEY` |
| Na API | `MAGO_ANEXOS_*` e `MAGO_CLAMAV=clamav:3310`, gravados no `api.env` pelo `segredos.sh` |
| Antivírus | container `mago-os-clamav-1` (compose da VPS02), rede `mago-os_mago_antivirus`, sem porta para fora |

## Ligar na VPS02 (uma vez)

1. Copiar `infra/vps02/compose.yaml`, `bin/segredos.sh` e `bin/publicar.sh` para `/opt/mago-os/` (guardando cópia dos
   antigos com o final `.antes-anexos`).
2. `sudo /opt/mago-os/bin/segredos.sh` (grava os `MAGO_ANEXOS_*` no `api.env`).
3. `cd /opt/mago-os && sudo docker compose up -d clamav` (só o antivírus: o banco não reinicia). O primeiro início
   baixa as assinaturas e leva alguns minutos.
4. `sudo /opt/mago-os/bin/publicar.sh forcar` (a API nova sobe com as variáveis e entra na rede do antivírus).

Nada disso toca na Ratoeira.

## Conferir

- `docker ps --filter name=clamav` mostra `healthy`.
- Na tela, anexar um PDF: aparece "Conferindo no antivírus..." e, em segundos, o nome vira link.
- O arquivo de teste EICAR aparece como "Bloqueado pelo antivírus" e chega o aviso no sino.

## Se o antivírus cair

Os anexos ficam em "Conferindo no antivírus..." (nada é liberado sem a conferência). O log da API mostra
`anexos.empresa_falhou`. `cd /opt/mago-os && sudo docker compose up -d clamav` e, quando ficar `healthy`, a fila libera
sozinha no minuto seguinte.

## Regra de CORS do bucket

A tela do Backblaze só libera baixar. A regra com envio foi aplicada pela API S3 (`PutBucketCors`) com a chave do
bucket: origem `https://teste.osmago.com`, métodos GET, PUT e HEAD, cabeçalho `content-type`, `etag` exposto, 3600
segundos. Mexer nas regras de CORS pela tela do Backblaze apaga essa regra: se o envio parar de funcionar com erro de
CORS no navegador, aplique de novo.

## Trocar a chave do bucket

Criar a chave nova no Backblaze (só o bucket, leitura e escrita), trocar `B2_ANEXOS_KEY_ID` e
`B2_ANEXOS_APPLICATION_KEY` no Infisical, rodar o `segredos.sh` e `publicar.sh forcar`, e só então apagar a antiga.

## Espaço

A conta gratuita tem 10 GB, divididos com o backup e a auditoria. A administração vê quanto cada empresa ocupa, e a
verificação diária (9h UTC) registra `anexos.espaco` no log quando os anexos passam de 5 GB: hora de decidir o plano
pago (no M6, junto com a produção).
