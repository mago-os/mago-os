# WhatsApp pela Evolution API: ligar, reconectar e o que fazer se cair

Como funciona: [decisão 0052](../decisoes/0052-evolution-api.md). Resumo: uma Evolution API por ambiente, na VPS02,
sem porta para fora. Só a API do Mago OS fala com ela, pela rede `mago_evolution`, e ela manda os avisos (número
conectou, caiu, mensagem chegou) de volta para a API pela mesma rede, com um segredo no cabeçalho. Cada canal de
WhatsApp do Mago OS é uma instância da Evolution com o nome `<empresa>_<canal>`.

## Onde fica cada coisa

| O quê | Onde |
| --- | --- |
| Versão | `evoapicloud/evolution-api:v2.3.8` no `compose.yaml` (fixa; a 2.4 pede ativação num servidor de fora: só troca com o ok do Sandro) |
| Container | `mago-os-evolution-1` (teste) e `mago-os-producao-evolution-1` (produção), perfil `evolution` do compose, 512 MB e meio processador |
| Redes | `<projeto>_mago_evolution` (a API entra com o nome `api`, pelo `publicar.sh`) e `<projeto>_mago_db` (o banco) |
| Banco | banco `evolution`, usuário `evolution`, no PostgreSQL do ambiente (`bin/evolution-banco.sh`); vai no backup junto |
| Segredos | Infisical, por ambiente: `MAGO_EVOLUTION_CHAVE` (a chave global dela), `MAGO_EVOLUTION_SEGREDO` (o dos avisos) e `MAGO_DB_SENHA_EVOLUTION` |
| Arquivos no servidor | `evolution.env` (a Evolution) e as `MAGO_EVOLUTION_*` no `api.env`, gravados pelo `segredos.sh` |
| Bloqueio na borda | o Caddy responde 404 a `/api/interno/*`: os avisos só entram pela rede do servidor |

## Ligar num ambiente (uma vez, só com o ok escrito do Sandro)

Nada disso toca na Ratoeira. Antes, conferir a memória livre (`free -m`: precisa sobrar mais de 1 GB depois dos 512 MB).

1. Criar os três segredos no Infisical do ambiente, pelo Mac (identidade claude-mac, ver [segredos.md](segredos.md)):
   `openssl rand -hex 24` para a chave e a senha do banco, `openssl rand -hex 32` para o segredo dos avisos.
2. Copiar `compose.yaml`, `bin/segredos.sh`, `bin/publicar.sh`, `bin/evolution-banco.sh` e o modelo do Caddy para a
   pasta do ambiente (guardando cópia dos antigos com o final `.antes-evolution`).
3. `sudo <pasta>/bin/segredos.sh` (grava `evolution.env` e as `MAGO_EVOLUTION_*` no `api.env`).
4. `sudo <pasta>/bin/evolution-banco.sh` (cria o banco e o usuário dela).
5. Conferir a imagem: `docker pull evoapicloud/evolution-api:v2.3.8` e anotar o resumo (`docker image inspect ...
   --format '{{index .RepoDigests 0}}'`) na decisão 0052. Conferir no `.env.example` da 2.3.8 que os nomes das
   variáveis do `evolution.env` continuam os mesmos.
6. `cd <pasta> && sudo docker compose --profile evolution up -d evolution` (só ela: o banco não reinicia).
7. `sudo <pasta>/bin/publicar.sh forcar` (a API sobe com as variáveis, entra na rede com o nome `api`, e o Caddy
   ganha o bloqueio de `/api/interno`).

## Conferir

- `docker ps --filter name=evolution` mostra `healthy`; `docker stats --no-stream` mostra menos de 512 MB.
- `curl -s -o /dev/null -w '%{http_code}' https://teste.osmago.com/api/interno/evolution/avisos` responde 404.
- Na tela Canais, "Conectar WhatsApp" cria o canal e mostra o QR code; lendo com o celular, o canal fica "Conectado".

## Se o número cair

O canal fica em vermelho e os administradores e a equipe do canal recebem o aviso (tela, push e Telegram). Causas
comuns: o celular ficou sem internet por muito tempo, alguém desconectou o aparelho em "Aparelhos conectados", ou o
WhatsApp bloqueou o número. Para voltar: Canais, "Ler o QR code" e ler com o celular do número.

## Se a Evolution cair

A tela mostra "A conexão de WhatsApp não respondeu agora" e as mensagens deixam de chegar (o WhatsApp guarda as
mensagens no celular; ao voltar, a Evolution entrega o que conseguir). `docker logs --tail 50 <container>` e
`cd <pasta> && sudo docker compose --profile evolution up -d evolution`. Os avisos que a API não conseguiu tratar
ficam na fila `evolution` e são tentados de novo sozinhos.

## Depois de uma remontagem

As sessões do WhatsApp ficam no banco dela, que volta com o backup. Em geral os números reconectam sozinhos quando a
Evolution sobe. Se um canal ficar "Desconectado", o administrador da empresa lê o QR code de novo em Canais. No ensaio
de desastre (`infra/producao/ensaio-remontagem.sh`), a Evolution do ensaio nunca sobe: as sessões restauradas
tomariam a conexão dos números da produção. O ensaio só confere que o banco dela voltou.

## Trocar a chave ou o segredo

Gerar o novo no Infisical, `segredos.sh`, `docker compose --profile evolution up -d --force-recreate evolution` e
`publicar.sh forcar`. O segredo dos avisos fica gravado em cada instância: depois de trocar, cada canal precisa ser
criado de novo (ou ter o webhook atualizado), por isso só trocar em caso de vazamento.
