# 0002 Backup do banco no Backblaze B2 em vez do Cloudflare R2

- **Data:** 16/11/2026
- **Situação:** aceita (registrada aqui na M0-01; a decisão e a instalação foram feitas no mesmo dia, antes do código)
- **Tarefa:** M0-11

## Contexto

O plano e a spec previam o backup do banco no Cloudflare R2. Na hora de criar o depósito, o R2 pedia cartão de crédito para ativar.

## Decisão

Usar o **Backblaze B2**: grátis até 10 GB sem cartão e, depois, US$ 6,95 por TB por mês. Bucket privado `mago-os-backup` na região EUA Leste, com criptografia da Backblaze e Object Lock ligados, e uma chave que só acessa esse bucket. O pgBackRest criptografa tudo (AES-256) antes de sair da VPS. As chaves ficam no Infisical.

## Descartado

- **Cloudflare R2:** exigia cartão para ativar.
- **Guardar o backup na própria VPS02:** não protege contra perda do servidor.

## Consequências

- O pgBackRest fala com o B2 pela interface compatível com S3, então trocar de fornecedor depois é só mudar as variáveis no Infisical.
- Os anexos do M3-05 continuam previstos no R2; a escolha do depósito dos anexos fica para quando o M3 for detalhado.
- Detalhes da instalação: `infra/vps02/` e a página `backup.md` da Wiki do cliente.
