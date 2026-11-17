# 0013 Sessões e aparelhos

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026)
- **Tarefa:** M1-08

## Contexto

A spec pede a lista de aparelhos conectados com desconectar um ou todos, a sessão expirando por inatividade e o alerta de login em aparelho novo. "Pronto quando": o Sandro desconecta o celular pelo computador e o celular sai na hora.

## Decisão

1. **Etiqueta do aparelho:** cada aparelho recebe um cookie de longa duração (`mago_aparelho`, HttpOnly, 400 dias) com um código aleatório. O banco guarda só a impressão digital (SHA-256) em `acesso.aparelhos`, por pessoa, com um nome legível tirado do navegador ("Chrome no Mac"). Cada sessão aponta para o aparelho de onde veio.
2. **Aviso de aparelho novo:** quando a pessoa entra por um aparelho que nunca usou (e já tem outro), nasce um aviso em `acesso.avisos`. Ele aparece nos outros aparelhos, nunca no próprio aparelho novo, como uma faixa "Novo acesso: ... Foi você?". "Não fui eu" desconecta as sessões daquele aparelho, esquece o aparelho (se voltarem a entrar por lá, o aviso volta) e sugere trocar a senha. O aviso conta já no passo da senha, mesmo que o 2FA barre depois: a senha foi usada num aparelho estranho. O aviso por e-mail entra com o Resend (M1-07).
3. **Inatividade e máximo:** a sessão cai depois de 3 dias sem uso (o Better Auth renova o prazo a cada hora de uso) e, mesmo em uso contínuo, depois de 30 dias. O máximo e o último uso são conferidos pelo Mago OS em toda consulta de sessão (`sessaoAindaVale`); o último uso é gravado no máximo a cada 5 minutos.
4. **Meus aparelhos e desconectar:** `GET /api/acesso/aparelhos`, `POST /api/acesso/aparelhos/desconectar` e `.../desconectar-outros`, só com a sessão completa (com o 2FA, quando ele vale) e só para as sessões da própria pessoa. Desconectar apaga a sessão no banco: o próximo pedido daquele aparelho já é recusado, e a tela confere a sessão a cada minuto e volta para a tela de entrar.
5. **Uma sessão por aparelho:** entrar de novo no mesmo aparelho tira as sessões antigas dele (ajuste de 17/11/2026, depois do teste do Sandro, que mostrou linhas repetidas).
6. **IP verdadeiro:** o site passa pela Cloudflare, e o IP que chegava era o dela. O Caddy passou a entregar à API o IP que a Cloudflare informa (`CF-Connecting-IP`), só quando o pedido vem dos IPs oficiais da Cloudflare; de outro lugar, vale o IP de quem conectou, para ninguém inventar um IP. Isso vale para a lista de aparelhos e para o limite de tentativas por minuto.
7. **Tela simples** "Meus aparelhos" e a faixa de avisos, adiantadas da M1-10.

## Descartado

- **Reconhecer o aparelho pelo IP ou só pelo navegador:** IP muda (celular, Wi-Fi) e muitos aparelhos têm o mesmo navegador; o cookie identifica o aparelho de verdade.
- **Impressão digital do navegador (fingerprinting):** invasivo e frágil; a etiqueta em cookie é explícita e fica só com a pessoa.
- **Sessão sem limite enquanto em uso:** um aparelho esquecido ligado ficaria conectado para sempre.

## Consequências

- A lista de IPs da Cloudflare fica no modelo do Caddy (`infra/vps02/caddy/mago-os.caddy.modelo`) e precisa de revisão de vez em quando.
- Apagar os cookies do navegador faz o aparelho parecer novo (gera aviso); é o comportamento esperado.
- O desligamento de uma pessoa (M1-07) vai apagar todas as sessões dela com o mesmo mecanismo.
- Os eventos `sessao.encerrou` vão para o log e, na M1-09, para a auditoria encadeada.
