# 0020 Anexos no Backblaze B2, com envio direto pela quarentena e antivírus ClamAV

- **Situação:** Aceita
- **Data:** 20/11/2026
- **Tarefa:** M3-08

## Contexto

A M3 traz os anexos nas tarefas e nos comentários. O plano previa o Cloudflare R2, e a decisão 0002 deixou a escolha
do depósito dos anexos para quando o M3 fosse detalhado. O R2 pede cartão para ativar; o backup e a auditoria já estão
no Backblaze B2.

## Decisão

- **Depósito:** Backblaze B2 (decisão do Sandro em 19/11/2026), com um bucket por ambiente (`mago-os-anexos-teste` em
  19/11/2026; o de produção no M6), privado, com criptografia, guardando só a última versão de cada arquivo, e uma
  chave só daquele bucket. O Google Drive foi descartado como depósito (não segue o padrão S3, não gera link
  temporário e prenderia os arquivos a uma conta Google); colar o link de um arquivo do Drive na tarefa fica para a
  Fase 2.
- **Envio direto:** o navegador manda o arquivo direto para o bucket por um link pré-assinado de 5 minutos, que assina
  também o tipo e o tamanho (o bucket recusa outro arquivo). O núcleo só dá o link depois de conferir permissão, tipo e
  tamanho (até 25 MB, sem extensões que rodam programa). Assinatura AWS v4 escrita no próprio núcleo, sem biblioteca.
- **CORS:** a tela do Backblaze só libera o navegador para baixar. A regra que libera também o envio (GET, PUT e HEAD,
  só de `https://teste.osmago.com`, cabeçalho `content-type`) foi aplicada pela API S3 (`PutBucketCors`) com a própria
  chave do bucket, com o ok do Sandro.
- **Quarentena:** o arquivo chega em `quarentena/<empresa>/<sorteado>`. A fila (pg-boss, a cada minuto e na hora do
  envio) lê o arquivo, passa pelo ClamAV e, se limpo, copia para `empresas/<empresa>/anexos/<anexo>`. Infectado é
  apagado, o anexo fica "bloqueado" e quem enviou e os administradores recebem o aviso `anexo_bloqueado`.
- **Antivírus:** ClamAV num container próprio na VPS02 (`clamav/clamav`), sem porta para fora, alcançado pela API numa
  rede só dos dois, com as assinaturas atualizadas pelo freshclam. No Mac e nos testes, um conferente que só reconhece
  o arquivo EICAR; a configuração recusa subir fora do Mac com anexos ligados e sem ClamAV.
- **Baixar:** link pré-assinado de 5 minutos, gerado depois da checagem de permissão. Só imagem e PDF abrem na tela; o
  resto sempre baixa como arquivo, para nada rodar no navegador.
- **Apagar:** todo anexo que sai do banco (excluído, ou junto com a tarefa ou o comentário) deixa o caminho em
  `arquivos_para_apagar`, por gatilho, e a fila apaga do bucket. Envio que não terminou em uma hora some sozinho.
- **Espaço:** a conta do Backblaze é a gratuita (10 GB divididos com backup e auditoria). Exclusão imediata, sem
  lixeira; a administração vê quanto a empresa ocupa (`/empresa/espaco-dos-anexos`); acima de 5 GB no total, a
  verificação diária registra um erro para o Sandro rever o plano.
- **Local e testes:** no lugar do Garage previsto na spec, uma pasta do computador servida pela própria API, com links
  assinados por um segredo sorteado ao ligar. Mais simples para o Mac e para a verificação do GitHub; o Garage continua
  previsto para a edição instalável.

## Consequências

- O arquivo não passa pela VPS02 no envio nem no download, só na conferência do antivírus.
- O ClamAV usa cerca de 1,2 GB de memória na VPS02, com limite de 1,5 GB no compose.
- Trocar de depósito (R2, Garage, outro S3) é só configuração: o núcleo fala o padrão S3.
