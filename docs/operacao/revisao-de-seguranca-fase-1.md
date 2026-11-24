# Revisão de segurança da Fase 1

Feita em 24/11/2026 (M6-04), antes da produção. Cada item da "Revisão de segurança" do plano (aprovada em
10/11/2026) e o que as decisões técnicas (0001 a 0043) prometeram, com a situação: **feito**, **feito nesta
revisão**, **falta** (com prazo) ou **Fase 2** (com o motivo). Grave e alto não podem ficar abertos antes da M6-05.

## Resumo

| Gravidade | Abertos | Observação |
| --- | --- | --- |
| Grave | 0 | |
| Alto | 0 | Os dois achados altos desta revisão foram corrigidos aqui (itens A1 e A2) |
| Médio | 3 | Viram cartões, com prazo: M1, M2 e M3 |
| Baixo | 2 | Viram cartões: B1 e B2 |

## Achados desta revisão

| Item | Gravidade | O que era | Situação |
| --- | --- | --- | --- |
| A1 | Alto | O erro do sistema (500) voltava para a tela com a mensagem interna (por exemplo, o texto do banco com nomes de tabelas e de restrições) | **Feito nesta revisão:** a pessoa recebe "Algo deu errado do nosso lado" com o número de rastreio; o detalhe fica só no registro (`servidor.ts`, com teste) |
| A2 | Alto | A tela não tinha política de conteúdo (CSP) nem proteção contra ser aberta dentro de outro site (clique enganado), e havia um script escrito no `index.html` | **Feito nesta revisão:** CSP sem script de fora nem escrito na página, `X-Frame-Options DENY`, `frame-ancestors 'none'` e `Permissions-Policy`, no Caddy e na prévia dos testes de tela (todos os testes de tela rodam com eles); o script do tema virou arquivo |
| — | Médio (corrigido) | As rotas públicas de convite (abrir, aceitar, criar empresa pelo convite) não tinham limite de pedidos | **Feito nesta revisão:** 20 por minuto por endereço, contados no banco (`acesso/limite-de-pedidos.ts`, com teste) |
| — | Baixo (corrigido) | O `manifest.webmanifest` saía sem tipo (Content-Type) | **Feito nesta revisão:** o Caddy manda `application/manifest+json` |
| M1 | Médio | O teste aceita conexões direto no IP da VPS02, sem passar pela Cloudflare (a proteção contra derrubada e robôs fica de fora para quem souber o IP) | Falta: na produção (M6-05) o app.osmago.com só aceita pedidos da Cloudflare (regra no Caddy, já na spec); no teste, aceito até lá |
| M2 | Médio | O root entra por SSH com chave (sem senha), e a porta 22 fica aberta para a internet, porque a VPS02 é dividida com a Ratoeira | Aceito com motivo (decisão 0006): só chave, sem senha, 2FA na Hostinger; fechar a porta 22 e o root quando a Ratoeira sair da VPS02 |
| M3 | Médio | Canal público para reportar falhas de segurança | **Feito nesta revisão em parte:** `SECURITY.md` no repositório; falta o Sandro ligar o "Private vulnerability reporting" do GitHub (é configuração do repositório) |
| B1 | Baixo | A chave de agente não vence sozinha nem pode ser limitada por IP | Fase 2 (item 4 do plano); hoje: revogável a qualquer hora, limite de pedidos por minuto por chave |
| B2 | Baixo | Trocar o `MAGO_ACESSO_SEGREDO` (o segredo dos cookies) também desfaz o 2FA por app de todo mundo, porque o segredo do app autenticador é cifrado com ele | Escrito no plano de incidente: depois da troca, cada pessoa cadastra o app de novo (as passkeys continuam) |

## Os itens do plano

### Arquitetura

| # | Item | Situação |
| --- | --- | --- |
| 1 | Isolamento entre empresas também no banco (Fase 1) | **Feito.** RLS ligado e forçado em toda tabela (teste do banco), `comEmpresa`/`comPessoa`, e o teste de vazamento da M6-01 percorre todas as rotas, ferramentas e canais a cada PR. As 54 funções que passam por cima do isolamento estão numa lista conferida |
| 2 | Rede interna separada | **Feito para o que existe:** a rede do banco é interna (sem internet); a API publica só em 127.0.0.1. Containers de agentes ainda não existem (Fase 2) |
| 3 | Proteção na frente da VPS (Cloudflare) | **Feito, com M1:** teste.osmago.com passa pela Cloudflare; a origem ainda aceita conexão direta |
| 4 | Chaves de API e webhooks | **Feito na parte da Fase 1:** chaves de agente revogáveis, com resumo no banco e limite por minuto; webhook do Telegram conferido por segredo; campainha assinada (HMAC). Validade, escopo e limite por IP: Fase 2 (B1) |

### Operação da VPS

| # | Item | Situação |
| --- | --- | --- |
| 5 | Acesso de administração (Fase 1) | **Feito, com M2:** SSH só com chave, sem senha, usuário `mago-admin` pela Tailscale, 2FA na Hostinger, firewall só 22, 80 e 443 |
| 6 | Atualizações e vulnerabilidades | **Feito:** atualização automática de segurança do Ubuntu ligada; Dependabot; `pnpm audit` (alto e crítico) e gitleaks em cada PR; **nesta revisão:** Trivy nas bibliotecas e na configuração dos containers em cada PR, Trivy na imagem antes de cada publicação (crítico não publica) e OWASP ZAP no teste depois de cada publicação e toda segunda |
| 7 | Auditoria à prova de alteração (Fase 1) | **Feito** (decisão 0014): corrente por empresa, cópia travada por 1 ano no Backblaze, verificação diária com aviso |
| 8 | Plano de incidente | **Feito nesta revisão:** [incidente.md](incidente.md), com o ensaio da troca de chaves no teste |
| 9 | Restauração testada e ambientes separados | **Feito:** teste de restauração toda segunda (M0-11); o teste só tem dados falsos. O ensaio de remontar tudo do zero é a M6-03 |
| 10 | Teste de invasão e canal de falhas | Teste de invasão pago: Fase 2, antes do primeiro cliente de fora (decisão 9 da spec do M6). Canal: M3 |

### Uso pelos usuários

| # | Item | Situação |
| --- | --- | --- |
| 11 | Sessões (Fase 1) | **Feito** (decisão 0013): aparelhos, desconectar, 3 dias sem uso e 30 de máximo, aviso de aparelho novo, desligar corta tudo na hora |
| 12 | Alto risco só no app (Fase 1) | **Feito** (decisão 0026): ações de alto risco não viram ferramenta de agente nem passam pelo Telegram |
| 13 | Senhas e login | **Feito:** senhas vazadas recusadas, trava de 15 minutos depois de 5 erros, limite por minuto no login; **nesta revisão:** cookies conferidos por teste (Secure, HttpOnly e SameSite fora do Mac) e limite nas rotas de convite. Links do portal do cliente: Fase 2 |
| 14 | Exportação em massa e acesso do suporte | Fase 2 (não há exportação nem acesso do suporte na Fase 1; apagar e exportar uma empresa é procedimento do Dono, decisão 10 da spec do M6) |
| 15 | LGPD com fornecedores | **Falta, fora do código:** contratos de tratamento de dados com os provedores de IA e o Backblaze, e o encarregado de dados (DPO). Precisa ser resolvido pelo Sandro antes do primeiro cliente de fora; para a 4xpert (empresa dele) não bloqueia |

### LGPD e privacidade (13/11/2026)

Os oito itens (pedidos dos titulares, base legal, prazos de guarda, relatório de tratamento, transferência
internacional, cookies nos sites, crianças e dados sensíveis, GDPR) dependem dos contatos, do CRM e dos sites, que
são da Fase 2. Na Fase 1: os registros e o rastreio saem do servidor sem dado pessoal (decisão 0043), a auditoria
não leva dado sensível nos detalhes (decisão 0014) e cada coluna do banco é marcada (`[pessoal]`, `[sensivel]`).

## O que as decisões técnicas prometeram

Conferido nas decisões que tratam de segurança (0005, 0006, 0009 a 0017, 0019 a 0021, 0025, 0026, 0031 a 0035, 0038,
0042 e 0043) e, em todas, nos pontos que deixaram algo para depois (o que ficou para o M6, para a produção ou para
"depois"). O que é da Fase 1 está feito, com estas observações:

- **0005 (main sem trava):** substituída pela 0038 (main protegida pelo GitHub desde 22/11/2026).
- **0006 (SSH):** M2 acima.
- **0011 (2FA):** o piso da plataforma está ligado; B2 acima sobre a troca do segredo.
- **0020 (anexos):** o depósito de produção é decidido na M6-05 (bucket próprio na conta grátis, decisão do Sandro).
- **0021 (cofre):** a troca da chave mestra foi ensaiada no teste nesta revisão (ver incidente.md). Apagar uma
  empresa apaga a chave de dados dela: fica no procedimento do Dono (decisão 10 da spec do M6).
- **0015 e 0013 (aviso de aparelho novo por e-mail):** entrou na M3-06.
- **0032 a 0035 (Telegram):** o token do bot sai dos registros e do rastreio (decisão 0043).

## Varreduras desta revisão

- **OWASP ZAP (modo básico) no teste, antes das correções:** nenhuma falha; 8 avisos. Corrigidos aqui: falta de
  CSP, de proteção contra abrir em outro site, de Permissions-Policy e o tipo do manifesto. Aceitos e anotados em
  `.zap/regras.tsv`: cache dos arquivos públicos, "app moderno" e Cross-Origin-Embedder-Policy (não usamos recursos
  que precisam dele).
- **Trivy (bibliotecas e containers):** nenhuma falha alta ou crítica nas bibliotecas; um aviso na imagem do banco
  (roda como root na montagem), aceito em `.trivyignore.yaml` com o motivo (o PostgreSQL troca para o usuário
  postgres ao subir).
- **gitleaks (todo o histórico):** nada.
- **pnpm audit:** nada alto ou crítico (a exceção da picomatch continua no cartão #55).
