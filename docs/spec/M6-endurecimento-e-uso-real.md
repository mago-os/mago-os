# Spec da Fase 1: M6 Endurecimento e uso real

Parte da [spec da Fase 1](README.md). Estado em 24/11/2026: **aprovado** pelo Sandro, com as recomendações e as escolhas dele: a produção roda na própria VPS02, ao lado do teste e da Ratoeira, e o backup fica na conta grátis do Backblaze, sem contratar nada novo.

**Pronto quando:** a 4xpert usa o Mago OS no dia a dia em app.osmago.com. O Sandro entra em app.osmago.com com senha e 2FA, convida a equipe, cria os projetos e as tarefas da semana, fala com o coordenador pelo bot do Telegram de produção e liga o Hermes pelo MCP de produção. Por baixo, os testes provam que nenhuma rota, ferramenta de agente, busca, anexo, aviso ou canal deixa uma empresa ver a outra; o número de rastreio de um erro leva ao caminho inteiro do pedido; a produção é remontada do zero a partir do backup, num lugar separado dela, com o tempo medido; a revisão de segurança não tem nada grave aberto; e o plano de incidente está escrito e ensaiado. Nenhuma publicação em produção acontece sem o clique do Sandro.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M6-01 | Testes de vazamento entre empresas em todas as partes | M5 | M |
| M6-02 | Rastreio técnico completo, com número de rastreio de ponta a ponta | M5 | M |
| M6-04 | Revisão de segurança da Fase 1 e plano de incidente | M6-01 | M |
| M6-05 | Ambiente de produção: servidor, contas separadas e publicação com aprovação | M6-04 | M |
| M6-05b | app.osmago.com no ar: DNS, bot, login com Google, avisos e a primeira empresa (proposta nova, decisão 5) | M6-05 | P |
| M6-03 | Restauração do backup e remontagem da produção do zero | M6-05 | M |
| M6-06 | Início do uso pela 4xpert e ajustes | M6-05b | M |

A ordem da tabela é a ordem de construção. A M6-04 vem antes da produção para que os problemas encontrados sejam corrigidos antes de existir dado real. A M6-03 vem depois da M6-05 porque o ensaio que importa é o da produção. A M6-05b é proposta nova: a M6-05 original juntava o servidor, a publicação, as contas de fora e o DNS, e ficou grande demais (decisão 5).

**O que não entra no M6** (como já está no plano): cobrança e Asaas, revenda e multiempresa da parte fechada (`mago-os-cloud`); teste de invasão pago por empresa de fora (decisão 9); importação de dados de outras ferramentas (decisão 11); tela para apagar empresa e exportar os dados (a Fase 1 tem só o procedimento do Dono, decisão 10); segundo servidor, banco separado e balanceador (o plano começa com uma VPS); WhatsApp e os outros canais da Fase 2; a central de ajuda e a lista de subprocessadores da LGPD (Fase 2).

### M6-01 Testes de vazamento entre empresas em todas as partes

Precisa da aprovação do Sandro só se aparecer mudança no isolamento do banco.

- [x] Um teste que percorre **todas as rotas da API** registradas no Fastify, com duas empresas e os mesmos perfis nas duas, e confere que nenhuma resposta traz um id, um nome ou um texto da outra empresa (decisão 1). Rota nova que não estiver no teste faz a verificação falhar, para nada novo escapar
- [x] O mesmo para **todas as ferramentas dos agentes** (internas e do MCP) e para os canais: Telegram (vínculo, conversa, arquivos, botões), tempo real (o que chega pelo canal de eventos), push, e-mail de aviso, resumo do dia, busca Ctrl+K, anexos (link de envio e de baixar) e rotinas
- [x] Ids da outra empresa colocados à mão nos pedidos (na rota, no corpo e nos filtros) são recusados como "não encontrado", sem dizer que o item existe
- [x] O teste de banco que já existe (toda tabela com `empresa_id`, RLS ligado e forçado e política com `empresa_ativa()`) passa a conferir também as funções do banco que rodam como dono (`security definer`), uma por uma, contra uma lista aprovada
- [x] Os trabalhos do sistema (fila, alertas, rotinas, resumo do dia, auditoria) rodam com duas empresas cheias e conferem que cada um só toca a sua
- [x] O que o teste encontrar é corrigido no mesmo PR, ou vira cartão próprio se for grande, e entra na revisão da M6-04

Feito em 24/11/2026 (decisão 0042). O teste achou e corrigiu dois pontos: a visão salva e o pedido de aprovação de agente guardavam ids de outra empresa (sem mostrar nada dela).

Pronto quando: a verificação roda o teste de vazamento em cada PR, cobrindo 100% das rotas e ferramentas, e uma rota nova sem cobertura faz a verificação ficar vermelha.

### M6-02 Rastreio técnico completo, com número de rastreio de ponta a ponta

- [ ] O número de rastreio (o trace id do OpenTelemetry, decisão 0003) passa a seguir o trabalho inteiro: do pedido da tela para a fila, da fila para o motor dos agentes, para a chamada ao provedor de IA, para o Telegram e para as rotinas. Um trabalho que nasce de outro guarda o número de quem o criou
- [ ] Os registros e o rastreio saem do servidor para um destino central (decisão 2), sem dado pessoal nem sensível: nada de texto de tarefa, mensagem, e-mail ou token nos registros (um filtro apaga o que escapar, com teste)
- [ ] Toda mensagem de erro que o usuário vê traz o número de rastreio com um botão de copiar, para ele mandar ao suporte
- [ ] Painel simples do rastreio no destino central: erros por hora, os pedidos mais lentos, a fila parada e os agentes com erro, com um alerta no Telegram do Sandro quando os erros passam de um limite
- [ ] Manual de operação novo, `docs/operacao/rastreio.md`: como achar um pedido pelo número, o que cada painel mostra e o que fazer com cada alerta
- [ ] Testes: o número que volta no cabeçalho `x-rastreio` é o mesmo dos registros da fila e do motor do agente; o filtro apaga e-mail, token e texto de mensagem dos registros

Pronto quando: o Sandro copia o número de rastreio de um erro na tela, cola no painel e vê o caminho inteiro do pedido, da tela até o agente.

### M6-04 Revisão de segurança da Fase 1 e plano de incidente

Precisa da aprovação do Sandro (segurança).

- [ ] Revisão de cada item da "Revisão de segurança" do plano (aprovada em 10/11/2026) e das 41 decisões técnicas, com a situação de cada um: feito, falta ou fica para a Fase 2 com motivo. O resultado vira `docs/operacao/revisao-de-seguranca-fase-1.md`
- [ ] Varredura automática na verificação (decisão 9): OWASP ZAP no modo básico contra o teste, segredos esquecidos no histórico do Git (gitleaks), dependências (`pnpm audit`, que já roda) e a imagem do container (Trivy)
- [ ] Cabeçalhos de segurança conferidos e com teste: CSP sem `unsafe-inline` nos scripts, HSTS, sem o site dentro de outro (frame), cookies `Secure`, `HttpOnly` e `SameSite`
- [ ] Limites de pedidos conferidos em todas as rotas que aceitam senha, código, convite, webhook e campainha
- [ ] O que for grave ou alto é corrigido antes da M6-05; médio e baixo viram cartões com prazo
- [ ] **Plano de incidente** (`docs/operacao/incidente.md`, decisão 8): o que fazer em vazamento de dados, invasão do servidor, chave vazada e conta do Sandro tomada. Inclui quem avisar, a comunicação à ANPD e aos titulares em até 3 dias úteis, o "Parar todos os agentes", a troca de todas as chaves de uma vez (com o roteiro testado) e onde fica cada coisa
- [ ] Ensaio do plano no teste: troca de todas as chaves do teste com o roteiro, sem o sistema cair mais de 5 minutos

Pronto quando: a revisão está escrita, nada grave ou alto está aberto, a varredura roda em cada PR e o ensaio de troca de chaves no teste deu certo.

### M6-05 Ambiente de produção: servidor, contas separadas e publicação com aprovação

Precisa da aprovação do Sandro (publicação em produção, segurança e contas pagas).

- [ ] Produção na própria VPS02 (decisão 3, escolha do Sandro em 24/11/2026), sem custo novo: um conjunto de containers separado do teste (`/opt/mago-os-producao`, com banco, API azul e verde, campainha e backup próprios), redes Docker próprias e portas locais diferentes. O teste e a produção não se enxergam. Limites de memória e de CPU em cada container, para o teste nunca tirar recurso da produção, e um alerta quando a memória livre da VPS02 ficar abaixo de 1 GB
- [ ] Nada da Ratoeira muda: o Caddy ganha só um arquivo novo para o app.osmago.com e é recarregado, nunca reiniciado; o firewall e o SSH continuam como estão. O app.osmago.com só aceita pedidos que vêm da Cloudflare (regra no próprio Caddy, só para esse endereço)
- [ ] Tudo de produção separado do teste (decisão 4): ambiente `prod` no Infisical com identidade própria só de leitura, bucket de backup e bucket de anexos próprios no Backblaze, na mesma conta grátis (os 10 GB passam a ser divididos com o teste, e o aviso de espaço passa a somar os dois ambientes, avisando acima de 7 GB), chave do cofre das contas de IA própria, chaves de push próprias, e o teste sem nenhum acesso à produção
- [ ] Publicação com aprovação (decisão 6): o teste continua recebendo cada mudança da main sozinho. A produção só recebe uma versão que já está no teste, a mesma imagem (sem montar de novo), e só depois que o Sandro aprova no GitHub (ambiente `producao` com o Sandro como aprovador obrigatório). Antes de trocar, um backup completo; depois, a conferência da saúde, e se falhar volta sozinha para a versão anterior
- [ ] Migrações compatíveis com a versão anterior (a versão velha continua funcionando com o banco novo durante a troca), com um teste que roda a versão anterior contra o banco migrado
- [ ] Backup da produção nos três depósitos, com a trava de 30 dias, o teste de restauração semanal e os avisos no Uptime Kuma, como no teste
- [ ] Manual de operação: `docs/operacao/producao.md` (publicar, voltar, ver o estado) e `infra/producao/README.md` (remontar do zero)

Pronto quando: a produção roda na VPS02, separada do teste e ainda sem DNS, e uma versão aprovada pelo Sandro no GitHub chega lá sem parar o sistema, com o backup antes da troca.

### M6-05b app.osmago.com no ar: DNS, bot, login com Google, avisos e a primeira empresa

Precisa da aprovação escrita do Sandro (DNS).

- [ ] Registro `app` na zona osmago.com da Cloudflare, com proxy, **só depois da aprovação escrita do Sandro** no chat
- [ ] Bot do Telegram de produção (criado pelo Sandro no BotFather, token no Infisical `prod`), com o webhook em app.osmago.com
- [ ] Cliente OAuth "Mago OS" do Google para app.osmago.com, com o app publicado (só nome, e-mail e foto, que não pedem verificação do Google)
- [ ] Remetente de e-mail de produção no Resend (o mesmo domínio, chave própria do ambiente `prod`)
- [ ] Vigias da produção no Uptime Kuma da VPS01 (API, tela, backup, restauração, auditoria), avisando no Telegram do Sandro
- [ ] Primeira empresa da produção: 4xpert (decisão 7), com o Sandro como Dono da plataforma e administrador, 2FA obrigatório para administradores desde o primeiro acesso
- [ ] O MCP de produção em app.osmago.com/mcp, e o guia dos agentes externos atualizado (cada agente ganha chave nova; as do teste não valem na produção)

Pronto quando: o Sandro entra em app.osmago.com, com senha ou Google e o 2FA, vincula o Telegram ao bot de produção e conversa com o coordenador.

### M6-03 Restauração do backup e remontagem da produção do zero

O teste de restauração do banco já roda toda segunda no teste (M0-11). Esta tarefa ensaia o desastre inteiro.

- [ ] Ensaio de desastre (decisão 12): na própria VPS02, num conjunto de containers e volumes à parte, remontar a produção só com o repositório, o Infisical e os backups do Backblaze, seguindo o `infra/producao/README.md` à risca, e medir o tempo. Meta: no ar em até 4 horas, perdendo no máximo 5 minutos de dados. O ensaio roda de madrugada, para não disputar memória com o uso
- [ ] Os anexos também voltam (decisão 12): o bucket de anexos de produção guarda as versões apagadas por 30 dias, e o ensaio confere que um anexo apagado volta
- [ ] A cópia da auditoria travada por 1 ano é conferida contra o banco restaurado (a corrente bate)
- [ ] O que o ensaio mostrar de errado no manual é corrigido no mesmo dia
- [ ] O ensaio se repete a cada 6 meses (cartão no quadro), e o teste semanal automático passa a rodar também na produção

Pronto quando: a produção foi remontada do zero a partir do backup, com o tempo medido e anotado no manual, e os containers do ensaio foram apagados.

### M6-06 Início do uso pela 4xpert e ajustes

- [ ] Começo com a empresa vazia (decisão 11): o Sandro convida a equipe da 4xpert, cria os espaços e os projetos, e as tarefas abertas entram à mão ou pelo coordenador
- [ ] Agentes da 4xpert na produção: coordenador e especialistas com as contas de IA da 4xpert no cofre, os tetos de gasto definidos pelo Sandro, e o Hermes ligado pelo MCP de produção
- [ ] Uso de verdade, com uma lista de ajustes no quadro (cartões "M6-06: ..."). Ajuste pequeno entra direto, com PR e o "ok" do Sandro; mudança de escopo vai para a Fase 2 com a aprovação dele. Sem prazo fixo de uso (decisão do Sandro em 24/11/2026): os ajustes continuam enquanto aparecerem, com prioridade sobre o resto, e a Fase 2 pode começar em paralelo
- [ ] O teste.osmago.com continua só com dados falsos, como lugar de conferir cada mudança antes da produção
- [ ] Alerta quando a VPS02 ou o Backblaze ficarem apertados (memória livre abaixo de 1 GB, disco acima de 80%, Backblaze acima de 7 GB), para o Sandro aumentar CPU, memória ou disco da VPS02 ou decidir o plano do Backblaze

Pronto quando: a equipe da 4xpert começa a usar o Mago OS em app.osmago.com, e o Sandro dá a Fase 1 por concluída.

## Decisões para o Sandro

1. **Como provar que nada vaza.** Recomendado: um teste automático que percorre sozinho todas as rotas e ferramentas com duas empresas, e que fica vermelho quando aparece uma rota nova sem cobertura. Alternativa: uma lista de testes escrita à mão, rota por rota (mais simples de começar, mas uma rota esquecida passa).
2. **Para onde vão os registros e o rastreio.** Recomendado: o Grafana Cloud no plano grátis (guarda 14 dias, com folga para o nosso volume), recebendo só dados técnicos, sem dado pessoal, e o alerta de erros no seu Telegram. Não pesa na VPS. Alternativa: instalar o Grafana na própria VPS (os dados não saem do servidor, mas gasta memória e é mais uma coisa para manter e fazer backup).
3. **Onde roda a produção. Decidido pelo Sandro em 24/11/2026:** na própria VPS02, ao lado do teste e da Ratoeira, sem custo novo, em containers separados e com limites de memória. Hoje a VPS02 usa cerca de 1 GB dos 8. Até o Sandro decidir, o teste continua na VPS02, ao lado da produção. No futuro, ele tira a Ratoeira e o teste de lá, que fica só para o app.osmago.com, e quando precisar de mais recurso ele aumenta CPU, memória ou disco dela. Por isso a produção é montada para ficar na VPS02 de vez, e o teste pode sair dali sem mexer nela.
4. **Contas separadas.** Recomendado: produção com tudo próprio (Infisical `prod`, buckets de backup e de anexos, chave do cofre, chaves de push, bot do Telegram e cliente do Google). **Decidido pelo Sandro em 24/11/2026:** o Backblaze continua na conta grátis (hoje usamos cerca de 1,4 GB de 10), e o Google Drive pago dele entra depois como cópia extra do backup (cartão #176).
5. **A M6-05 vira duas.** Recomendado: M6-05 (servidor, contas e publicação) e M6-05b (DNS, bot, Google, avisos e a primeira empresa), porque a segunda depende do seu "ok" escrito para o DNS e de contas que você cria. Alternativa: manter uma tarefa só, maior.
6. **Como se publica em produção.** Recomendado: o teste continua automático; a produção recebe só uma versão que já passou pelo teste, e só quando você aprova no GitHub (um botão "Approve and deploy" que chega por e-mail e no app do GitHub), com backup antes e volta sozinha se a saúde falhar. Eu nunca publico em produção sem esse clique. Alternativa: você escreve "publica em produção" no chat e eu disparo (mais simples, mas sem a trava do próprio GitHub).
7. **Primeira empresa da produção. Decidido pelo Sandro em 24/11/2026:** a 4xpert, a primeira a usar de verdade como cliente (a mesma que abriu o teste). As outras empresas dele entram depois, pelo comando de início ou pelo convite.
8. **Plano de incidente.** Recomendado: um passo a passo curto para os quatro casos (vazamento, invasão, chave vazada e conta tomada), com o aviso à ANPD e às pessoas afetadas em até 3 dias úteis, como manda a regra da ANPD, e o roteiro de troca de todas as chaves ensaiado no teste.
9. **Teste de invasão.** Recomendado: na Fase 1, a revisão completa mais as varreduras automáticas (ZAP, gitleaks, Trivy e as dependências), sem contratar empresa de fora. O teste de invasão pago fica para antes de vender para o primeiro cliente de fora. Alternativa: contratar agora (mais seguro, mas custa e atrasa o uso pela 4xpert).
10. **Apagar uma empresa e exportar os dados.** Recomendado: na Fase 1, só um procedimento escrito para o Dono, rodado por comando, que exporta tudo e apaga a empresa (com a chave de dados do cofre junto). A tela fica para a Fase 2, com a LGPD completa. Alternativa: fazer a tela já no M6.
11. **Dados da 4xpert no começo.** Recomendado: começar com a empresa vazia e trazer as tarefas abertas à mão ou pelo coordenador, sem importar de outra ferramenta (a importação está no plano da Fase 2). Se a 4xpert hoje usa uma ferramenta com muitas tarefas abertas, me diga qual, e eu vejo se vale uma importação simples só dela.
12. **Ensaio de desastre e anexos.** Recomendado (sem contratar nada, como o Sandro pediu): remontar a produção do zero em containers à parte na própria VPS02, de madrugada, com a meta de 4 horas e no máximo 5 minutos de dados perdidos, e o bucket de anexos guardando por 30 dias o que for apagado, para um anexo apagado por engano voltar. O ensaio num servidor novo e vazio fica para quando o teste sair da VPS02.
