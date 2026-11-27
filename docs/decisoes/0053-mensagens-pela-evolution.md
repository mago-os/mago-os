# 0053 Receber e enviar mensagens pela Evolution

- **Data:** 27/11/2026
- **Situação:** proposta (esperando a aprovação do Sandro)
- **Tarefa:** M8-03

## Contexto

A spec do M8 (aprovada em 27/11/2026) pede, na M8-03, receber texto, foto, documento, áudio, localização e contato
compartilhado, enviar texto, foto e documento com a situação da entrega, as mensagens mandadas direto pelo celular, o
ritmo de envio por número, sem repetir nem trocar a ordem, e grupos de fora. A tarefa não está marcada como sensível
na spec, mas três pontos mexem em contrato, banco e segurança, e por isso pedem o olho do Sandro antes do código
(marcados com **pede o seu olho**). O resto segue a spec e as decisões 0051 e 0052.

Conferido na imagem 2.3.8 que está no teste: a Evolution manda a mensagem nova no aviso `messages.upsert`, a mudança
de entrega no `messages.update` (ERROR, PENDING, SERVER_ACK, DELIVERY_ACK, READ, PLAYED), e o que o próprio número
mandou com `fromMe`. Os contatos que o WhatsApp esconde atrás de um "LID" (endereço sem o telefone) chegam com o
telefone em `remoteJidAlt`.

## Decisão

1. **Receber.** Cada `messages.upsert` vira uma mensagem pela `receberMensagem` da M8-01 (acha o contato, abre ou
   continua a conversa, não grava duas vezes pelo número da mensagem, ordem pela hora do WhatsApp). Texto e legenda
   viram o texto; localização vira "Localização: <nome> (lat, long)" com o link do mapa; contato compartilhado vira o
   nome e o telefone dele (sem criar contato sozinho); figurinha, enquete, reação e o resto viram "tipo de mensagem
   ainda não mostrado aqui", sem perder o aviso. Grupos (`@g.us`) e status (`status@broadcast`) são ignorados
   (decisão 11 da spec). Endereço LID: usa o telefone de `remoteJidAlt`; sem ele, o contato fica "não identificado"
   pelo LID, e a conversa avisa que o telefone veio escondido.
2. **Arquivos das conversas** (foto, documento e áudio). **Pede o seu olho:** a tabela `anexos` de hoje é só das
   tarefas. Proponho uma tabela nova, `arquivos_de_conversa`, com `empresa_id`, RLS e as marcas, ligada à mensagem, no
   mesmo bucket dos anexos (pasta própria `conversas/`), com o mesmo antivírus e a mesma fila. O arquivo é baixado da
   Evolution pelo núcleo (nunca pelo navegador), até 25 MB como os anexos; o bloqueado pelo antivírus aparece como
   "arquivo bloqueado pelo antivírus" e nunca é liberado. Prazo de 180 dias (decisão 7 da spec): uma verificação
   diária apaga os arquivos vencidos, e a mensagem fica com o texto e "arquivo apagado pelo prazo". A alternativa é
   generalizar a tabela `anexos` para também servir às conversas (mexe numa tabela que já está em uso).
3. **Enviar.** Uma rota nova manda texto, foto ou documento numa conversa (permissão `conversas.criar`, o alcance da
   M8-01): a mensagem entra como "pendente", a fila manda pela Evolution, e a resposta grava o número da mensagem; os
   avisos `messages.update` mudam para enviada, entregue, lida ou falhou (com o motivo). "Tentar de novo" na mensagem
   que falhou. A foto ou o documento enviado sai de um anexo já conferido pelo antivírus. O agente (M8-05) usa o mesmo
   caminho. **Pede o seu olho:** é um contrato novo (o pedido de mensagem e a resposta) e uma ação que sai da empresa;
   proponho auditar cada envio (`conversa.enviou`, só com ids, sem o texto).
4. **Pelo celular.** O que o próprio número manda (`fromMe`) entra como "saiu", marcado "pelo celular". Para não
   duplicar o que a caixa acabou de mandar (o aviso pode chegar antes da resposta da Evolution), a mensagem do
   celular com o mesmo número de mensagem, ou com o mesmo texto de uma pendente da mesma conversa nos últimos 2
   minutos, junta-se a ela em vez de criar outra.
5. **Ritmo de envio por número.** **Pede o seu olho** nos números: padrão de **20 mensagens por minuto e 300 por
   hora** por canal, e no máximo **1 mensagem a cada 3 segundos para o mesmo contato**. O que passa do limite fica
   "pendente" e sai sozinho quando der; o administrador recebe um aviso novo, `canal_segurando_mensagens` (no máximo um
   por hora por canal). O administrador pode mudar os limites do canal depois (a tela vem com a M8-04).
6. **Segurança.** O texto do contato é só texto (a tela nunca monta HTML com ele). O nome do arquivo que vem de fora é
   limpo antes de gravar. A Evolution só é chamada pelo núcleo, com a chave dela. Os avisos de mensagem também passam
   pelo segredo e pela fila (decisão 0052).
7. **Testes com a Evolution falsa:** chegou (cada tipo), saiu pelo celular, repetida, fora de ordem, grupo ignorado,
   LID, arquivo limpo e com vírus, envio com entrega e falha, tentar de novo, ritmo segurando e liberando, e o
   isolamento entre empresas (aviso com a instância de uma empresa nunca grava na outra).

## O que foi descartado

- **Guardar as mensagens no banco da Evolution:** desligado na 0052; o Mago OS guarda o que importa.
- **Baixar o arquivo pelo navegador direto da Evolution:** a Evolution não tem porta para fora.
- **Responder em grupos:** fica de fora (decisão 11 da spec).

## Consequências

- Banco: migração com `arquivos_de_conversa`, o aviso novo e os limites do canal (colunas em `canais_de_contato`).
- Contratos: a mensagem que sai, o arquivo da conversa e as ações de auditoria.
- Núcleo: tratar `messages.upsert` e `messages.update`, o envio pela fila com o ritmo, o arquivo com o antivírus e a
  verificação diária do prazo.
- Pronto quando: com a Evolution falsa, cada tipo de mensagem chega certo, a foto passa pelo antivírus, a mensagem
  enviada fica "lida" com os avisos, a que falha mostra o motivo e sai de novo com um toque, o ritmo segura e libera,
  e nada se repete nem passa de uma empresa para a outra.
