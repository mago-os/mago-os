# Login (acesso)

Como cuidar do login no teste (M1-03 e M1-04). O porquê das escolhas está nas decisões [0009](../decisoes/0009-login-com-better-auth.md) e [0010](../decisoes/0010-login-com-google.md); as tabelas, em [docs/banco](../banco/README.md) (esquema `acesso`).

Os comandos abaixo rodam no Mac, com o alias `vps02` do SSH. `IMG` é a versão no ar:

```bash
IMG='$(cat /opt/mago-os/estado/atual)'
```

## Conta nova para um cliente (M1-11)

O caminho normal é pela tela: o Dono abre **Empresas › Convidar nova conta** e informa o nome e o e-mail do responsável. O responsável recebe o e-mail, cria a senha e os dados da conta (empresa com CNPJ ou pessoa física com CPF) e vira o administrador. O Dono não entra na conta. Ver [decisão 0016](../decisoes/0016-convite-para-criar-empresa.md).

## Plano B: criar uma conta pelo comando (Dono da plataforma)

O comando de início cria o Dono da plataforma e uma conta onde ele é administrador. Hoje só é usado em emergência ou para uma conta do próprio Sandro:

```bash
ssh vps02 "docker run --rm --network mago-os_mago_db --env-file /opt/mago-os/api.env $IMG node src/plataforma.ts iniciar --nome 'Sandro' --email 'pessoa@exemplo.com' --empresa '4xpert'"
```

## Primeiro acesso: link para definir a senha

A pessoa roda no próprio Mac e vê o link só no terminal dela. O link vale 1 hora e só funciona uma vez. **Nunca mandar o link por chat ou e-mail aberto**: ele dá acesso à conta.

```bash
ssh vps02 "docker run --rm --network mago-os_mago_db --env-file /opt/mago-os/api.env $IMG node src/acesso/link-de-senha.ts --email 'pessoa@exemplo.com' 2>/dev/null"
```

O "Esqueci a senha" da tela manda o link por e-mail, pelo Resend (remetente `nao-responda@osmago.com`). Sem a chave `MAGO_RESEND_CHAVE` (no Mac), o link vai só para o log da API (evento `senha.pediu_recuperacao`).

## Convidar e desligar pessoas (M1-07)

Pela tela: **Pessoas › Convidar pessoa**. O convite chega por e-mail, vale 7 dias e funciona uma vez só. Na ficha da pessoa: **Reenviar o convite** (o link anterior para de valer), **Cancelar o convite** e **Desligar** (o acesso àquela empresa cai na hora, em todos os aparelhos). Ninguém desliga a si mesmo nem o último administrador. Ver [decisão 0015](../decisoes/0015-convites.md).

Se um e-mail não chegar: conferir no painel do Resend (Emails) se ele saiu e se o domínio `osmago.com` continua verificado; os registros `send`/`resend._domainkey` ficam na Cloudflare. Sem a chave no Mac, o link do convite aparece no log da API (evento `vinculo.convidou`).

## Trocar o e-mail de login de uma pessoa

```bash
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"update pessoas set email = 'novo@exemplo.com', email_verificado = true, atualizada_em = now() where email = 'antigo@exemplo.com'\""
```

`email_verificado = true` só quando o novo e-mail foi informado pela própria pessoa (o login com Google exige e-mail confirmado). Senha, sessões, empresas e papéis continuam ligados à pessoa.

## Destravar um e-mail

Depois de 5 senhas erradas seguidas, o e-mail trava por 15 minutos. Para liberar antes:

```bash
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"delete from acesso.travas where email = 'pessoa@exemplo.com'\""
```

## Cliente do Google (login com Google)

- **Onde:** Google Cloud, projeto **Mago OS**, dono `nlk.osmago77@gmail.com` (conta separada, só para o Mago OS). Menu "Google Auth Platform".
- **Cliente OAuth:** "Mago OS teste", aplicativo da Web. Origem `https://teste.osmago.com`; endereço de volta `https://teste.osmago.com/api/acesso/callback/google`. O ID e a chave secreta ficam no Infisical (`MAGO_GOOGLE_ID` e `MAGO_GOOGLE_SEGREDO`, ver [segredos.md](segredos.md)).
- **Escopos:** só `openid`, `userinfo.email` e `userinfo.profile`. Domínio autorizado: `osmago.com`.
- **Público: "Testando".** Só entra pelo Google quem está em "Usuários de teste" (até 100). Hoje: `nlk.osmago77@gmail.com`. Para publicar ("Em produção"), o Google pede a página inicial e a Política de Privacidade no Branding: fica para quando o Mago OS tiver a página de privacidade. Sem logo, os escopos básicos não precisam de revisão do Google.
- **Outro ambiente (produção):** criar outro cliente (ou somar os endereços) com a origem e o endereço de volta do novo domínio.
- **Trocar a chave secreta:** em Clientes › Mago OS teste, criar uma chave nova, gravar no Infisical, rodar `segredos.sh` e `publicar.sh forcar` na VPS02, e só então apagar a antiga no Google.

## 2FA (app autenticador e passkey)

- Obrigatório para o Dono da plataforma e para administradores (e para todos de uma empresa com `exigir_dois_fatores`). Quem precisa e não tem entra numa tela que só deixa ativar. Detalhes na [decisão 0011](../decisoes/0011-dois-fatores.md).
- **Regras** (até as telas de configuração da M1-10). A empresa só aperta; o piso do Dono vale para todas:

```bash
# Empresa: exigir 2FA de todos, ou passkey de todos
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"update empresas set exigir_dois_fatores = true where nome = '4xpert'\""
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"update empresas set exigir_passkey = true where nome = '4xpert'\""
# Piso da plataforma (Dono): administradores e Dono só com passkey, em todas as empresas
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"update acesso.regras_da_plataforma set exigir_passkey_administradores = true\""
```

- **Perdeu o celular e os códigos:** desliga o 2FA da pessoa e derruba as sessões; ela ativa de novo no próximo login. Confirmar antes, por outro canal, que é mesmo a pessoa.

```bash
ssh vps02 "docker run --rm --network mago-os_mago_db --env-file /opt/mago-os/api.env $IMG node src/acesso/desligar-dois-fatores.ts --email 'pessoa@exemplo.com'"
```

- As passkeys ficam presas ao domínio (`teste.osmago.com`). Em outro domínio (produção), cada pessoa cadastra a sua de novo.

## Sessões e aparelhos

- Cada pessoa vê e desconecta os próprios aparelhos em **teste.osmago.com/aparelhos**. A sessão cai depois de 3 dias sem uso e, no máximo, depois de 30 dias. Detalhes na [decisão 0013](../decisoes/0013-sessoes-e-aparelhos.md).
- **Desconectar todos os aparelhos de uma pessoa** (por exemplo, conta comprometida), sem mexer no 2FA:

```bash
ssh vps02 "docker exec -i mago-os-db-1 psql -U mago -d mago -c \"delete from acesso.sessoes where pessoa_id = (select id from pessoas where email = 'pessoa@exemplo.com')\""
```

- **IP dos acessos:** o site passa pela Cloudflare. O Caddy entrega à API o IP verdadeiro (`CF-Connecting-IP`) só para pedidos vindos dos IPs oficiais da Cloudflare, listados no modelo do Caddy. Se a Cloudflare mudar a lista (cloudflare.com/ips), atualizar o modelo, copiar para `/opt/mago-os/caddy/` e rodar `publicar.sh forcar`.
