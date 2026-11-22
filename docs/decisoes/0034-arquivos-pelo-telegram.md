# 0034 Arquivos pelo Telegram

- **Data:** 22/11/2026
- **Situação:** aceita (aprovada pelo Sandro no chat em 22/11/2026)
- **Tarefa:** M5-03

## Contexto

Pelo Telegram a pessoa manda foto de um documento, um PDF ou um áudio e diz "anexa na tarefa do contrato". A M5-03 faz esse arquivo virar anexo da tarefa certa, com o mesmo antivírus e as mesmas regras dos anexos do app (M3-08). A decisão 5 da spec do M5, aprovada em 22/11/2026, diz que na Fase 1 o agente não lê o conteúdo.

## Decisão

1. **O que entra.** Foto (a maior das versões que o Telegram manda), documento, áudio, mensagem de voz, vídeo e vídeo redondo, até 20 MB, que é o limite do Telegram para um bot baixar. Os tipos que rodam programa (a lista dos anexos, M3-08) são recusados pelo nome. Figurinha e GIF recebem "não viram anexo".
2. **O arquivo espera a tarefa.** Ao chegar, o arquivo é registrado como "esperando" (nome, tipo, tamanho e o número do arquivo no Telegram), ligado à pessoa (na empresa do Telegram), por até 24 horas. Nada é baixado nessa hora: se ninguém anexar, ele vence e não há o que apagar.
3. **O coordenador decide onde anexar.** A mensagem segue para a conversa como qualquer pedido: a legenda (texto da própria pessoa) e uma linha com os dados do arquivo, nunca o conteúdo. Por exemplo: "[Arquivo recebido pelo Telegram, esperando uma tarefa: contrato.pdf (application/pdf, 340 KB), id ...]". Com a legenda clara, o coordenador anexa; sem ela, ele pergunta.
4. **Duas ferramentas novas dos agentes internos.** `arquivos_recebidos` (lista os que esperam, de quem pediu; executa) e `anexar_arquivo` (arquivo e tarefa; executa). Anexar só vale em tarefa que quem pediu pode editar, com o alcance do responsável pelo agente (M4-04), e o arquivo precisa ser de quem pediu e estar esperando. Depois de ler texto de outra pessoa, anexar pede aprovação, como toda ação que muda dados.
5. **Anexar usa o caminho dos anexos.** Ao anexar, o núcleo baixa o arquivo do Telegram, põe na quarentena do depósito (B2) e cria o anexo em "verificando". A fila dos anexos passa o antivírus, como no app: limpo, fica disponível; infectado, é apagado, o anexo fica "bloqueado" e o bot avisa no Telegram.
6. **Vários arquivos de uma vez.** Um álbum chega como várias mensagens. A primeira segue para o coordenador; as que chegam com ele ainda respondendo ficam esperando, e o bot avisa "Recebi o arquivo. Ele fica esperando por 24 horas: diga em qual tarefa anexar". O coordenador acha os que esperam com `arquivos_recebidos`.
7. **Autor do anexo.** O anexo fica como enviado pela pessoa (não pelo agente), porque foi ela quem mandou o arquivo; a auditoria do anexo diz que veio pelo Telegram.

## Detalhes acertados na implementação

- **Nome e tipo:** o nome vem do aparelho quando o Telegram manda (documento e áudio); senão, foto-<data>.jpg, audio-<data>.ogg, video-<data>.mp4. O tipo vem do Telegram quando é válido; senão, o padrão de cada um.
- **Anexar em três passos:** confere o arquivo e a tarefa; baixa do Telegram fora da transação; cria o anexo e marca o arquivo como anexado numa transação só (dois pedidos ao mesmo tempo anexam uma vez). Se gravar no depósito falhar, o anexo some e o arquivo volta a esperar.
- **Auditoria:** `anexo.enviou` com a pessoa como autora, o canal Telegram e o agente que anexou nos detalhes.
- **Verificação a cada minuto:** a mesma das respostas do Telegram (fila "telegram-entregas") vence os arquivos esperando há mais de 24 horas e avisa os bloqueios.

## O que foi descartado

- **Baixar o arquivo logo que chega:** guardaria no depósito arquivos que talvez nunca virem anexo, e o espaço do B2 gratuito é curto.
- **Anexar sozinho, sem o coordenador:** a tarefa certa quase sempre vem da legenda ou da conversa, que o coordenador já entende; uma regra fixa ("a última tarefa da conversa") erraria em silêncio.

## Consequências

- Contratos: os campos de arquivo em `MensagemDoTelegram`, `ArquivoDoTelegram`, o limite e as respostas novas em `contratos/src/canais/telegram.ts`; as ferramentas `arquivos_recebidos` e `anexar_arquivo` (descrições congeladas) e as regras no catálogo.
- Banco: tabela `arquivos_do_telegram` (com `empresa_id`, RLS pela empresa e pela pessoa, o número do arquivo no Telegram marcado `[sensivel]`).
- Pronto quando: o Sandro manda uma foto ao bot com a legenda "anexa na tarefa do contrato da DFO" e a foto aparece na tarefa.
