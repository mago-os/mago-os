# Plano de incidente

Escrito em 24/11/2026 (M6-04). O que fazer, na ordem, nos quatro casos: **vazamento de dados**, **invasão do
servidor**, **chave vazada** e **conta do Sandro tomada**. Vale para o teste e para a produção (troque `staging` por
`prod` e teste.osmago.com por app.osmago.com).

Regra de ouro: **primeiro conter, depois entender, depois avisar.** Anotar tudo (hora, o que viu, o que fez) num
cartão do quadro com a etiqueta "incidente", desde o primeiro minuto.

## Onde fica cada coisa

| O quê | Onde |
| --- | --- |
| Servidor | VPS02 (Hostinger), `ssh mago-vps02` (Tailscale); painel da Hostinger com 2FA |
| Segredos | Infisical, projeto `mago-os` ([segredos.md](segredos.md)) |
| Código e publicação | GitHub `mago-os/mago-os` (main protegida), imagem em `ghcr.io/mago-os/mago-os` |
| Backup e auditoria | Backblaze B2 (`mago-os-backup`, `mago-os-auditoria`), travados ([backup.md](backup.md), [auditoria.md](auditoria.md)) |
| DNS e proteção | Cloudflare, zona `osmago.com` (mudança só com o "ok" escrito do Sandro) |
| Registros e rastreio | Grafana Cloud ([rastreio.md](rastreio.md)); no servidor, `docker logs` |
| Quem decide e avisa | O Sandro (Dono da plataforma e controlador dos dados) |

## Primeiros 15 minutos (todos os casos)

1. **Parar os agentes**, se houver qualquer chance de um agente estar sendo usado no ataque: na tela, Agentes ›
   "Parar todos os agentes" (com 2FA e motivo), ou, para todas as empresas, o Dono pela tela da plataforma.
2. **Avisar o Sandro** (se não foi ele que viu) pelo Telegram e por telefone.
3. **Abrir o cartão do incidente** e anotar a hora em que se soube.
4. **Guardar as provas antes de mexer:** o número de rastreio do pedido suspeito, os registros
   (`docker logs --since 24h mago-os-api-azul > /root/incidente-$(date +%F-%H%M).log`, ou a cor no ar) e a busca no
   Grafana. Não apagar nada.

## 1. Vazamento de dados (uma empresa viu dado de outra, ou dados saíram)

1. **Conter:** se o vazamento vem de uma rota ou ferramenta, voltar a versão anterior (`/opt/mago-os/bin/publicar.sh
   voltar`) e, se preciso, parar a API pela publicação até a correção. Se veio de uma chave, ir para o caso 3.
2. **Entender:** quais empresas e pessoas, quais dados (usar as marcas das colunas: `[pessoal]`, `[sensivel]`), desde
   quando e por onde (rastreio, auditoria de cada empresa).
3. **Corrigir** com o teste que reproduz o vazamento junto (no teste de vazamento da M6-01, se couber), e publicar.
4. **Avisar (LGPD):** quando o incidente pode causar risco ou dano relevante às pessoas, comunicar a **ANPD** e as
   **pessoas afetadas** em até **3 dias úteis** da hora em que se soube (Resolução CD/ANPD nº 15/2024). O aviso diz:
   o que aconteceu, que dados, quantas pessoas, o que já foi feito, o que a pessoa pode fazer e um contato. Quem
   assina é o Sandro (controlador); avisar também as empresas clientes afetadas, que são controladoras dos dados dos
   clientes delas.
5. **Depois:** nota curta no cartão (o que houve, por que, o que mudou) e, se for o caso, uma decisão nova.

## 2. Invasão do servidor

1. **Conter:** na Hostinger, tirar um snapshot da VPS (prova) e só então isolar: firewall só com a Tailscale, ou
   desligar a VPS se houver dano em curso. **Atenção:** a VPS02 também roda a Ratoeira; avisar o Sandro antes de
   desligar.
2. **Trocar todas as chaves** (caso 3, a lista inteira), de outro computador limpo.
3. **Remontar** num servidor novo a partir do repositório, do Infisical e do backup (remontagem do zero: M6-03 e
   `infra/vps02/README.md`). Não reaproveitar o servidor invadido.
4. **Conferir a auditoria:** a cópia travada no Backblaze mostra se a corrente foi mexida
   (`auditoria-verificar.sh`).
5. **Avisar** como no caso 1, se dados podem ter sido lidos.

## 3. Chave vazada (troca de chaves)

Trocar primeiro a que vazou; numa invasão, trocar todas. Cada troca: gravar o valor novo no Infisical (pelo Mac,
`infra/ferramentas/infisical-gravar.py`, o valor nunca aparece na tela), rodar `/opt/mago-os/bin/segredos.sh` e
`/opt/mago-os/bin/publicar.sh forcar` (troca de cor, sem parar o site).

| Chave | Como trocar | O que acontece |
| --- | --- | --- |
| `MAGO_DB_SENHA_APP`, `MAGO_DB_SENHA_ACESSO` | Gravar nova; o `publicar.sh` já faz o `ALTER ROLE` | Nada para as pessoas |
| `MAGO_DB_SENHA_DONO` | Gravar nova, `ALTER ROLE mago PASSWORD` no banco, depois `docker compose up -d --force-recreate db` | Alguns segundos sem banco |
| `MAGO_ACESSO_SEGREDO` | Gravar nova (32 ou mais caracteres) | Todas as sessões caem, e o 2FA por app autenticador de todo mundo precisa ser cadastrado de novo (o segredo dele é cifrado com esta chave); as passkeys continuam |
| `MAGO_COFRE_CHAVE_MESTRA` | Como em [cofre.md](cofre.md): a atual vai para `MAGO_COFRE_CHAVE_ANTERIOR`, nova mestra, `MAGO_COFRE_VERSAO` +1 | Nada para as pessoas; as chaves de dados são cifradas de novo no primeiro uso |
| `MAGO_CAMPAINHA_SEGREDO` | Gravar nova no Infisical **e** no GitHub (`gh secret set MAGO_CAMPAINHA_SEGREDO`), `segredos.sh` e `systemctl restart mago-os-campainha` | Nada (a VPS também confere sozinha a cada minuto) |
| `MAGO_TELEGRAM_SEGREDO` | Gravar nova; a API registra o webhook de novo ao subir | Nada |
| `MAGO_TELEGRAM_TOKEN` | O Sandro faz /revoke no @BotFather e cola o novo no Infisical | O bot fica fora até a troca |
| `MAGO_GOOGLE_SEGREDO` | O Sandro gera outro no Google Cloud e cola no Infisical | Entrar com Google fica fora até a troca |
| `MAGO_RESEND_CHAVE` | O Sandro cria outra no Resend (só envio), cola e apaga a antiga | E-mails param até a troca |
| `MAGO_VAPID_*` | Gerar par novo | Todos precisam aceitar o push de novo no aparelho |
| `B2_*` (backup, anexos, auditoria) | O Sandro cria outra chave no Backblaze, só daquele bucket, cola e apaga a antiga | Nada; os arquivos travados continuam protegidos |
| `PGBACKREST_CIPHER_PASS` | Não se troca no lugar: cópia nova completa com a senha nova num repositório novo, e a antiga guardada até os backups antigos vencerem | Planejar com calma |
| `GRAFANA_OTLP_TOKEN`, `GRAFANA_API_TOKEN` | Criar outro no Grafana Cloud, gravar e apagar o antigo | Painel sem dados novos até a troca |
| `GHCR_LEITURA_TOKEN` | O Sandro apaga em github.com/settings/tokens, cria outro só com `read:packages` e cola | A VPS não baixa versão nova até a troca |
| Chave de um agente | Tela do agente › Chaves › Revogar, e criar outra | O agente para até receber a chave nova |
| Identidades do Infisical (`vps02`, `claude-mac`) | No Infisical, gerar novo segredo da identidade e atualizar `/opt/mago-os/infisical.env` e o arquivo do Mac | Nada |

**Ensaio (24/11/2026, no teste):** ver a seção "Ensaios" no fim.

## 4. Conta do Sandro tomada (Google, GitHub, Infisical, Hostinger, Cloudflare ou o Mago OS)

1. **Recuperar a conta** pelo provedor e trocar a senha; derrubar todas as sessões dele.
2. **Conferir o 2FA** (app ou passkey) e trocar os códigos de recuperação.
3. **Ver o que foi feito com a conta:** GitHub (audit log, PRs, segredos, regras da main), Infisical (registro de
   acesso), Hostinger (acessos e snapshots), Cloudflare (DNS), Mago OS (auditoria de cada empresa e da plataforma).
4. **Trocar as chaves** que a conta alcançava (caso 3).
5. No Mago OS: se a conta de Dono foi usada, conferir convites de empresa, regras da plataforma e paradas de
   agentes; em último caso, `pnpm plataforma:desligar-2fa` e novo primeiro acesso.

## Ensaios

| Data | O que foi ensaiado | Resultado |
| --- | --- | --- |
| 24/11/2026, 23h16 a 23h17 UTC | Troca, no teste, das chaves que não dependem do Sandro: `MAGO_DB_SENHA_APP`, `MAGO_DB_SENHA_ACESSO`, `MAGO_CAMPAINHA_SEGREDO` (Infisical e GitHub), `MAGO_TELEGRAM_SEGREDO` e `MAGO_COFRE_CHAVE_MESTRA` (versão 1 para 2, a anterior guardada) | **Sem queda:** 64 pedidos à saúde, um por segundo, todos respondidos. Conferido depois: a API entrou no banco com as senhas novas, o bot registrou o webhook com o segredo novo (o antigo recebe 401), a campainha aceita a assinatura nova (202) e recusa a errada (401). A chave de dados que ainda está na mestra antiga é cifrada de novo no primeiro uso; depois disso, apagar `MAGO_COFRE_CHAVE_ANTERIOR` (cofre.md, passo 4) |
