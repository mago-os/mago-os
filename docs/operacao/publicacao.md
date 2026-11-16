# Publicação no teste (teste.osmago.com)

Criada na M0-10. Toda mudança aprovada na main aparece sozinha em https://teste.osmago.com, sem ninguém mexer na VPS.

## Caminho de uma mudança

1. O PR é aprovado e entra na main.
2. A verificação (`verificacao.yml`) roda na main. Só se ficar verde segue.
3. A publicação (`publicacao.yml`) monta a imagem (API e tela juntas, `Dockerfile`) e guarda em `ghcr.io/mago-os/mago-os`, de forma privada, com duas marcas: o commit e `teste`.
4. O GitHub toca a **campainha** da VPS02 (`POST https://teste.osmago.com/_campainha`, assinada com `MAGO_CAMPAINHA_SEGREDO`). A campainha só faz a VPS conferir antes; ela não dá acesso a nada. Se a campainha falhar, a VPS confere sozinha a cada minuto.
5. Na VPS02, `/opt/mago-os/bin/publicar.sh`:
   - baixa a imagem nova;
   - roda as migrações do banco (se falharem, nada muda);
   - liga a versão nova **ao lado** da antiga (azul na porta 3101, verde na 3102);
   - confere a saúde da nova (`/saude` com a versão certa, até 60 segundos);
   - copia a tela da versão para `/srv/mago-os/telas/<versão>`;
   - troca o Caddy (`/etc/caddy/mago-os.caddy`, gerado do modelo) com **reload**, nunca restart, então a Ratoeira não sente;
   - confere de novo pelo endereço público;
   - só então desliga a antiga.
   Se qualquer passo falhar, a antiga continua no ar.
6. O GitHub confere teste.osmago.com por até 8 minutos. Se a versão nova não aparecer, o fluxo falha e o GitHub avisa o Sandro por e-mail e no app.
7. Se deu certo, a versão entra no **histórico de versões** (Releases do repositório, marca `teste-AAAAMMDD-HHMM-<commit>`), com a lista dos PRs que entraram, gerada sozinha.

## Comandos na VPS02 (`ssh mago-vps02`, depois `sudo -i`)

| Para | Comando |
| --- | --- |
| Ver a versão no ar | `cat /opt/mago-os/estado/versao` ou https://teste.osmago.com/api/saude |
| Ver o histórico de publicações | `cat /opt/mago-os/estado/historico` |
| Ver o que aconteceu na última publicação | `journalctl -u mago-os-publicar -n 100` |
| Publicar agora (sem esperar) | `systemctl start mago-os-publicar` |
| **Voltar para a versão anterior** | `/opt/mago-os/bin/publicar.sh voltar` |
| Publicar de novo a mesma versão | `/opt/mago-os/bin/publicar.sh forcar` |
| Pausar a publicação automática | `systemctl stop mago-os-publicar.timer mago-os-publicar.path` (voltar: `start`) |
| Registros da API | `docker logs -f mago-os-api-azul` (ou `-verde`, a que estiver em `/opt/mago-os/estado/cor`) |

Voltar uma versão não desfaz migrações do banco. Se a versão nova mudou o banco de um jeito que a antiga não entende, voltar o banco é uma decisão à parte (migração de volta ou restauração do backup, ver o manual de backup).

## Peças na VPS02

| Peça | Onde |
| --- | --- |
| Script de publicação | `/opt/mago-os/bin/publicar.sh` |
| Modelo do Caddy | `/opt/mago-os/caddy/mago-os.caddy.modelo` |
| Campainha | `/opt/mago-os/campainha/campainha.py`, serviço `mago-os-campainha` (usuário sem privilégios, só em 127.0.0.1:3190) |
| Disparo pela campainha | `mago-os-publicar.path` |
| Conferência a cada minuto | `mago-os-publicar.timer` |
| Estado (versão atual, anterior, cor) | `/opt/mago-os/estado/` |
| Telas publicadas (as 3 últimas) | `/srv/mago-os/telas/` |

## Segredos envolvidos

`MAGO_CAMPAINHA_SEGREDO` (Infisical e GitHub › Settings › Secrets) e `GHCR_LEITURA_TOKEN` (Infisical; token "classic" do Sandro só com `read:packages`, vence em 1 ano). Ver [segredos.md](segredos.md).
