# 0052 Evolution API no servidor

- **Data:** 27/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 27/11/2026, com os dois pontos)
- **Tarefa:** M8-02

## Contexto

A spec do M8, aprovada pelo Sandro em 27/11/2026, põe o WhatsApp primeiro pela Evolution API, uma por ambiente, na própria VPS02, sem porta aberta para a internet (decisão 4). A M8-02 sobe a Evolution e faz a tela de conectar um número pelo QR code. Esta nota traz o que eu conferi antes (sem mexer em nada no servidor) e o que proponho, com os pontos que pedem o olho do Sandro marcados com **pede o seu olho**.

### O que eu conferi em 27/11/2026

- **Memória da VPS02:** 7,9 GB no total, 4,9 GB disponíveis, 3,8 GB de troca quase livre, 2 processadores, disco com 49 GB livres. Os containers do Mago OS usam hoje cerca de 2,1 GB de verdade (os limites somam 7,5 GB, mas nenhum chega perto). Duas Evolutions de 512 MB cabem; o aviso de memória baixa da M6 continua vigiando. Não olhei nem toquei na Ratoeira.
- **Versão:** a última estável é a **2.3.8** (lançada em 23/11/2026). As versões **2.4.0** ainda são de teste (candidatas), e mudam uma coisa importante: cada instalação passa a precisar de **ativação no servidor de licenças da Evolution Foundation** antes de funcionar (sem ativação, a API responde 503), com um identificador da máquina e um sinal enviado a cada 30 minutos. A 2.3.8 não pede ativação.
- **Licença:** Apache 2.0 com condições a mais. O uso comercial é permitido, inclusive "como serviço por trás de outros aplicativos". Duas condições: (1) mostrar, num lugar que os administradores do sistema vejam (configurações ou documentação), que a Evolution API está em uso; (2) não tirar o logo nem o aviso de direitos da tela própria da Evolution (o "manager"), o que não se aplica a quem não usa essa tela. Quem não cumpre pode ter de comprar uma licença comercial.
- **O que ela precisa:** imagem oficial `evoapicloud/evolution-api`, PostgreSQL (ou MySQL) e, opcional, Redis para cache. Ela manda telemetria anônima (rotas usadas e versão).

## Decisão

1. **Versão fixa: 2.3.8**, a imagem marcada pelo número e pelo resumo (digest), nunca `latest`. **Pede o seu olho:** fico na 2.3.x e **não** subo para a 2.4.0 enquanto ela exigir a ativação no servidor de licenças, porque (a) se o servidor deles cair ou recusar, o WhatsApp de todos os clientes para, e (b) o sinal a cada 30 minutos manda dados nossos para fora. Antes de qualquer troca de versão, eu trago a nota de mudanças e você decide.
2. **Uma por ambiente, na VPS02:** `mago-os-evolution` (teste) e `mago-os-producao-evolution` (produção), cada uma no compose do seu ambiente, com limite de **512 MB** de memória e meio processador, reinício automático e checagem de saúde. **Nenhuma porta publicada:** ela não aparece na internet nem no Caddy. A produção só sobe quando você aprovar a publicação, como sempre.
3. **Rede:** uma rede própria por ambiente (`mago_evolution`) ligando só a API do Mago OS e a Evolution, e a rede interna do banco. A Evolution precisa sair para a internet (falar com os servidores do WhatsApp), então ela tem saída, mas ninguém de fora entra nela.
4. **Banco:** um banco `evolution` dentro do PostgreSQL de cada ambiente, com um usuário próprio que só enxerga esse banco (sem acesso às tabelas do Mago OS) e com limite de conexões. Entra no backup que já existe (pgBackRest e Backblaze). **Sem Redis:** com poucos números, o cache local dela basta, e é um container a menos. Se ficar lento, volto com a proposta.
5. **Segredos no Infisical**, por ambiente: a chave da Evolution (`AUTHENTICATION_API_KEY`), a senha do usuário do banco e o segredo dos avisos (abaixo). Gerados por mim com a identidade do Mac, como os outros, e nunca no Git.
6. **Avisos da Evolution para o Mago OS:** a Evolution manda cada aviso (mensagem chegou, entregue, lida, número conectado ou desconectado, QR code novo) pela rede interna para um endereço do núcleo que só existe nessa rede, com o segredo no cabeçalho. O núcleo confere o segredo, grava o aviso na fila e responde na hora; a fila processa depois, com novas tentativas, para nada se perder. Cada canal do Mago OS vira uma "instância" da Evolution, com o nome igual ao id do canal: o aviso de uma instância só mexe no canal dela, e o canal é de uma empresa só.
7. **Telemetria desligada.** A tela própria da Evolution (o "manager") fica inacessível, porque a Evolution não tem porta para fora: ninguém usa a Evolution a não ser o núcleo, pela API.
8. **Aviso de uso (condição da licença):** na tela Configurações > Canais, junto do aviso de risco que a spec já pede, entra "Conexão de WhatsApp pela Evolution API (código aberto, evolution-api)". Com isso a condição 1 da licença fica cumprida. **Pede o seu olho:** o texto e o lugar.
9. **Tela "Conectar WhatsApp"** (Configurações > Canais, só o administrador, módulo `canais`): nome do canal e equipe que atende; o QR code aparece e se atualiza sozinho até o celular ler; depois mostra o número conectado e a situação, com "desconectar". O número fica preso a uma empresa só (o banco já garante, M8-01). O aviso de risco: a Evolution não é oficial e o WhatsApp pode bloquear o número, principalmente com envio em volume ou para quem não autorizou.
10. **Número caiu:** aviso aos administradores e à equipe do canal (tela, push e Telegram) e o canal em vermelho. Reconectar é ler o QR de novo.
11. **Testes com a Evolution falsa:** um servidor falso, nos testes, que imita as respostas e os avisos da Evolution (QR, conectado, desconectado, mensagem). Todos os testes da M8-02 e da M8-03 rodam com ela, sem número de verdade. O número de verdade (decisão 5 da spec) só entra no teste final, em teste.osmago.com.
12. **Remontagem e backup:** o ensaio de desastre da M6-03 passa a subir a Evolution junto e a conferir o banco dela; o manual de operação ganha "reconectar os números depois de uma remontagem" (as sessões do WhatsApp ficam no banco dela, então em geral voltam sozinhas; se não, cada administrador lê o QR de novo).

## Ajustes ao construir (27/11/2026)

- A Evolution fica no perfil `evolution` do compose: só sobe com `--profile evolution`, para um `docker compose up` do banco nunca a ligar sem os segredos.
- O nome da instância é `<empresa>_<canal>`: o aviso diz de que empresa é, e o banco (RLS) só deixa mexer no canal daquela empresa. Assim não é preciso uma função que passe por cima do isolamento.
- O endereço dos avisos é `/interno/evolution/avisos`; o Caddy responde 404 a `/api/interno/*`, e sem o segredo a API responde 401.
- A tela confere a conexão na própria Evolution a cada pergunta pelo QR: se o aviso de "conectou" se perdeu, o canal fica conectado mesmo assim.
- O número lido que já está noutro canal (de qualquer empresa) é recusado: o canal fica desconectado, a sessão é encerrada e o administrador é avisado.
- O QR que expira antes de alguém ler não avisa ninguém; só avisa o número que estava conectado e caiu.
- Apagar só o canal sem conversas; o que já tem conversas é desconectado.
- A Evolution não guarda as mensagens no banco dela (só a instância): o Mago OS guarda o que importa (M8-01).
- No ensaio de desastre, a Evolution nunca sobe (as sessões restauradas tomariam os números da produção); o ensaio confere que o banco dela voltou.
- Manual de operação: [evolution.md](../operacao/evolution.md).

## O que foi descartado

- **Subir na 2.4.0:** depende de ativação num servidor de fora (item 1).
- **VPS própria para a Evolution:** custo novo sem necessidade agora (decisão 4 da spec).
- **Expor a Evolution pelo Caddy:** não há motivo; só o núcleo fala com ela.
- **Redis:** fica para quando houver muitos números.

## Consequências

- Infra: `infra/vps02/` (e a cópia da produção) com o serviço da Evolution, a rede e o banco; o script de segredos leva as três chaves novas para o ambiente. Nada sobe no servidor antes do seu ok escrito.
- Núcleo: o cliente da Evolution (criar instância, pedir o QR, ver a situação, desconectar), o endereço interno dos avisos com o segredo, o trabalho da fila e a tela de canais.
- Testes: a Evolution falsa e os testes de QR, conexão, queda e isolamento entre empresas.
- Pronto quando: na tela, o administrador cria o canal, vê o QR (com a Evolution falsa nos testes; com um número de verdade no teste final), o canal fica "conectado", e quando o número cai o canal fica vermelho e o administrador é avisado; uma empresa nunca vê o canal da outra.

Fontes conferidas em 27/11/2026: [licença](https://github.com/evolution-foundation/evolution-api/blob/main/LICENSE), [versões](https://github.com/evolution-foundation/evolution-api/releases), [README](https://github.com/evolution-foundation/evolution-api).
