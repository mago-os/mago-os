# Agentes externos: como ligar, trocar a chave e desligar

Guia do M2 (M2-07 e M2-08). Um agente externo roda fora do Mago OS (no Mac, numa VPS) e entra pelo servidor MCP com uma chave própria. Qualquer agente que fale MCP conecta do mesmo jeito; abaixo, o passo a passo geral, o do Hermes e o do Claude no Mac.

Referências: [decisão 0017](../decisoes/0017-chave-do-agente.md) (chave e agente vivo), [decisão 0019](../decisoes/0019-servidor-mcp.md) (servidor MCP) e [docs/api](../api/README.md) (as ferramentas, geradas dos contratos).

## O que o agente precisa saber

- **Endereço:** `https://app.osmago.com/mcp` na produção (desde 25/11/2026) e `https://teste.osmago.com/mcp` no teste (transporte HTTP do MCP, sem sessão). Cada ambiente tem as próprias chaves: a chave de um agente do teste não vale na produção. Para ligar um agente à produção, criar a chave na tela do agente em app.osmago.com e trocar, nos passos abaixo, `teste.osmago.com` por `app.osmago.com`.
- **Chave:** cabeçalho `Authorization: Bearer mago_ag_...`. Ela aparece uma vez só, na hora de criar. Nunca em arquivo versionado, commit, chat ou linha de comando.
- **Ciclo:** a cada minuto, `minhas_tarefas`; pegar a próxima (`pegar_tarefa`), comentar o andamento (`comentar`), entregar (`entregar_resultado`). Não soube fazer: `soltar_tarefa` com o motivo (a tarefa volta para a pessoa responsável pelo agente).
- **Sinal de vida:** todo pedido conta. Sem sinal por mais tempo que o limite do agente (padrão 15 minutos), a tarefa pegada volta para A fazer e a pessoa responsável é avisada. Trabalho longo: chamar `estou_vivo` de vez em quando.
- **Limites:** 60 pedidos por minuto e 500 registros lidos por hora. Passou: o agente é pausado e a pessoa responsável é avisada; volta com Retomar, na página do agente.
- **O que ele não faz no M2:** criar, excluir, cancelar ou reabrir tarefa, e trocar o responsável.

## Ligar qualquer agente externo

1. Em **Agentes**, o administrador clica **Cadastrar**: nome (ex.: "Hermes"), onde roda (ex.: "VPS01") e a pessoa responsável, que recebe os avisos.
2. Na página do agente, **Criar chave**, com um nome que diga onde ela vai ficar (ex.: "Hermes na VPS01"). Copie a chave na hora.
3. Guarde a chave num cofre (Infisical ou o Keychain do Mac) e entregue ao agente só pela configuração do servidor MCP dele, lida do cofre ou de uma variável de ambiente.
4. Configure o servidor MCP no agente: endereço acima e o cabeçalho `Authorization`.
5. Teste: crie uma tarefa com o agente como responsável e veja-a ser pegada, comentada e entregue na tela.

**Agente de teste genérico:** `infra/ferramentas/agente-de-teste.ts` faz o ciclo completo e serve de modelo. Com um agente de teste cadastrado e uma chave:

```bash
MAGO_AGENTE_CHAVE="$(cat)" node infra/ferramentas/agente-de-teste.ts --uma-vez
```

(cole a chave e aperte Ctrl-D; assim ela não fica no histórico do terminal). Sem `--uma-vez`, ele pergunta a cada minuto.

## Aviso imediato (M7-04)

Em vez de esperar a pergunta de cada minuto, o agente pode ser avisado **na hora** ([decisão 0049](../decisoes/0049-aviso-imediato-aos-agentes.md)). Precisa de um endereço https público no agente que receba um POST (o Hermes tem; o agente de teste não).

1. Na página do agente externo, parte **Aviso imediato**: cole o endereço (ex.: `https://hermes.minhaempresa.com/mago`) e clique **Ligar aviso**. O segredo (`whsec_...`) aparece uma vez: guarde no cofre, como a chave.
2. Clique **Mandar teste** e confira, nas últimas entregas, que chegou com código 2xx.
3. O Mago OS avisa em três casos: `agente.tarefa_recebida` (o agente ficou como responsável), `agente.mencionado` (alguém o mencionou com @ num comentário) e `agente.aprovacao_respondida` (uma ação que ele pediu foi aprovada ou recusada).
4. O aviso leva só ids, por exemplo `{"id":"<número da entrega>","evento":"agente.tarefa_recebida","ocorridoEm":"...","empresaId":"...","dados":{"tipo":"tarefa","id":"<tarefa>","status":"a_fazer","agenteId":"<agente>"}}`. Ao receber, o agente chama `minhas_tarefas` ou `ver_tarefa` com a chave dele.
5. **Conferir a assinatura** (cabeçalho `mago-assinatura: t=<segundos>,v1=<hex>`): calcule o HMAC SHA-256 de `<t>.<corpo exatamente como chegou>` com o segredo e compare com `v1`. Recuse se `t` tiver mais de 5 minutos e ignore um `mago-entrega` já recebido. Responda 2xx em até 10 segundos (depois trabalhe); senão, o Mago OS tenta de novo depois de 1, 5 e 30 minutos e 2, 6 e 12 horas, e desliga o aviso depois de 3 dias sem acertar (os administradores e a pessoa responsável pelo agente são avisados).

```js
// Node.js
import { createHmac, timingSafeEqual } from "node:crypto";
function avisoValido(corpo, cabecalho, segredo) {
  const partes = Object.fromEntries(cabecalho.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > 300) return false;
  const esperado = createHmac("sha256", segredo).update(`${partes.t}.${corpo}`).digest("hex");
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1 ?? ""));
}
```

```python
# Python
import hashlib, hmac, time
def aviso_valido(corpo: bytes, cabecalho: str, segredo: str) -> bool:
    partes = dict(p.split("=", 1) for p in cabecalho.split(","))
    if abs(time.time() - int(partes["t"])) > 300:
        return False
    esperado = hmac.new(segredo.encode(), f"{partes['t']}.".encode() + corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, partes.get("v1", ""))
```

6. **A pergunta continua como reserva:** com o aviso ligado, pergunte (`minhas_tarefas`) a cada **5 minutos** em vez de a cada minuto. Se um aviso se perder (o agente fora do ar), a tarefa chega pela pergunta.

## Trocar a chave sem parar

1. Crie a chave nova na página do agente.
2. Troque no cofre e reinicie a configuração do agente.
3. Confira na lista de chaves que a nova tem "Último uso" recente.
4. **Revogue** a antiga. A partir do pedido seguinte ela é recusada (e a recusa vai para a auditoria como `chave.recusou`).

## Pausar e desligar

- **Pausar:** o agente para de receber tarefa nova e os pedidos dele são recusados, mas as chaves ficam. **Retomar** volta tudo.
- **Desligar:** para na hora e não tem volta. As chaves deixam de valer, as tarefas que ele tinha pegado voltam para A fazer, as atribuídas a ele passam para a pessoa responsável, e ela recebe aviso no Mago OS e por e-mail.

## Hermes (VPS01)

O Hermes Agent (v0.23) roda em Docker na VPS01, instalado em `/opt/hermes`, com a configuração em `/root/.hermes`. Ele entra no Mago OS de fora para dentro, como qualquer agente externo: sem porta nova e sem tocar na Ratoeira (que fica na VPS02). **Os passos abaixo valem quando o Hermes estiver em produção** (decisão do Sandro em 18/11/2026); até lá, o agente de teste genérico prova o caminho.

1. **Cadastrar:** em Agentes da 4xpert, "Hermes", onde roda "VPS01", responsável Sandro.
2. **Chave:** criar "Hermes na VPS01" e guardar no Infisical, ambiente `staging`, como `MAGO_HERMES_CHAVE` (no Mac: `python3 -I infra/ferramentas/infisical-gravar.py staging MAGO_HERMES_CHAVE`, colando a chave na entrada, ver [segredos](segredos.md)).
3. **Levar a chave ao Hermes:** a VPS01 lê `MAGO_HERMES_CHAVE` do Infisical para a variável de ambiente do container do Hermes (no arquivo de ambiente do compose em `/opt/hermes`, fora de qualquer repositório). Nunca escrever a chave na configuração versionada.
4. **Servidor MCP no Hermes:** na configuração de servidores MCP do Hermes (em `/root/.hermes`), acrescentar um servidor HTTP chamado `mago-os`, com o endereço `https://teste.osmago.com/mcp` e o cabeçalho `Authorization: Bearer ${MAGO_HERMES_CHAVE}` lido da variável de ambiente. Conferir o nome exato das chaves de configuração na documentação da versão instalada do Hermes antes de editar, e reiniciar o container.
5. **Rotina de reserva e aviso imediato:** criar no Hermes uma tarefa agendada com as instruções abaixo, a cada minuto (cron `* * * * *`) enquanto ele não tiver o aviso imediato e a cada 5 minutos (`*/5 * * * *`) depois de ligar o aviso (M7-04, seção "Aviso imediato" acima). Com o aviso ligado, o endereço do Hermes que recebe o POST confere a assinatura e dispara a mesma rotina na hora.
6. **Teste do marco (depois do M2):** o Sandro cria a tarefa "verificar backup e espaço em disco da VPS01" para o Hermes, e o relatório aparece na tela.

**Instruções para o Hermes** (texto da rotina):

> Você trabalha para a 4xpert pelo Mago OS. A cada execução: chame `minhas_tarefas`. Se houver tarefa em A fazer, pegue a mais antiga com `pegar_tarefa`, comente que começou com `comentar`, faça o trabalho e entregue com `entregar_resultado`, escrevendo o que fez e o que encontrou, em português simples. Se não souber ou não puder fazer, chame `soltar_tarefa` explicando o motivo. Em trabalho longo, chame `estou_vivo` a cada poucos minutos. Nunca invente resultado. Só mexa nas suas tarefas.

## Claude no Mac (M2-08)

O Claude Code do Mac do Sandro entra como o agente "Claude no Mac". A chave fica no Keychain do Mac e é entregue ao Claude Code por um script que a lê na hora: ela não fica no arquivo de configuração do Claude.

1. **Cadastrar:** em Agentes da 4xpert, "Claude no Mac", onde roda "Mac do Sandro", responsável Sandro. Criar a chave "Mac do Sandro".
2. **Guardar no Keychain:** no Terminal do Mac,

   ```bash
   security add-generic-password -a mago-os -s mago-os-claude-no-mac -w
   ```

   (ele pede a chave duas vezes; cole a chave inteira).
3. **Configurar o MCP no Claude Code:** o servidor é HTTP, e o cabeçalho com a chave vem do script `infra/ferramentas/mcp-claude-no-mac.sh` (o "headersHelper" do Claude Code), que lê o Keychain a cada conexão. Registrar uma vez, para todos os projetos:

   ```bash
   claude mcp add-json mago-os --scope user '{"type":"http","url":"https://teste.osmago.com/mcp","headersHelper":"/Users/sandronolasco/MyBusiness/Nolask/Clientes/MagoOS/Sistemas/MagoOS/mago-os/infra/ferramentas/mcp-claude-no-mac.sh"}'
   ```

4. **Testar:** criar uma tarefa para o "Claude no Mac" e pedir no Claude Code: "pega minhas tarefas no Mago OS".
5. **Mac dormindo:** se o Mac dormir com uma tarefa pegada, depois de 15 minutos sem sinal ela volta para A fazer e o Sandro é avisado.
6. **Trocar a chave:** criar a nova na página do agente, rodar de novo o comando do Keychain com `-U` (atualiza), conferir o "Último uso" e revogar a antiga.
