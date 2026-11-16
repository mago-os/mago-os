# Acesso de administração à VPS02

A VPS02 (Hostinger, Campinas) é dividida com a Ratoeira. Estado em 16/11/2026, depois da M0-09.

## Quem entra e como

| Quem | Como | Para quê |
| --- | --- | --- |
| `mago-admin` | SSH só com chave (`~/.ssh/vps_mago_admin` no Mac), com `sudo` sem senha. Pela rede privada Tailscale (`vps02-ratoeira`) ou pelo IP público | Administração do dia a dia do Mago OS |
| `root` | SSH só com chave (`~/.ssh/vps_hostinger2`) | Emergências e o socorro da Ratoeira (o agente do computador do Sandro entra por aqui) |
| Console da Hostinger | Painel da Hostinger, protegido pelo 2FA da conta | Último recurso, se o SSH parar de responder |

No Mac: `ssh mago-vps02` (rede privada) ou `ssh vps02` (root, IP público).

## Regras do SSH

- Senha desligada para todos (`PasswordAuthentication no`) e root só com chave (`PermitRootLogin prohibit-password`). Aplicado pela receita da própria Ratoeira, `ssh-so-chave` (arquivo `/etc/ssh/sshd_config.d/10-ratoeira-senha.conf`). Para desfazer: `sudo bash /opt/ratoeira/fonte/kit/receitas/ssh-so-chave desfazer`.
- fail2ban vigia o SSH e bloqueia quem erra várias vezes.
- **A porta 22 continua aberta na internet**, só com chave. A Ratoeira depende dela para o socorro, então ela só fecha quando o Mago OS tiver VPS própria (decisão do Sandro em 16/11/2026, ver a [decisão 0006](../decisoes/0006-ssh-da-vps02.md)).

## Firewall (ufw)

Entrada bloqueada por padrão; abertas só 22 (SSH com chave), 80 e 443 (Caddy, da Ratoeira e do Mago OS). Os containers do Mago OS não publicam portas: o Docker abre portas por fora do ufw, então nenhum serviço do Mago OS fica exposto sem passar pelo Caddy. O Tailscale cria a interface `tailscale0`, que não depende dessas regras.

## Tailscale

Rede privada (WireGuard) da conta do Sandro. A VPS02 entrou com `--accept-dns=false` e `--accept-routes=false`: o Tailscale não muda o DNS nem as rotas do servidor, então a Ratoeira não é afetada. Ver os aparelhos em https://login.tailscale.com/admin/machines.

## Se perder o acesso

1. Tentar a outra porta de entrada (Tailscale ↔ IP público; `mago-admin` ↔ `root`).
2. Console da Hostinger (painel › VPS › Terminal do navegador), entrando como root.
3. Restaurar o snapshot da Hostinger (ela guarda só um, por 24 horas) ou o backup semanal dela.
