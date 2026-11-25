# 0044 Produção na VPS02, separada do teste, com publicação aprovada pelo Sandro

- **Data:** 25/11/2026
- **Situação:** aceita (decisões 3, 4 e 6 da spec do M6, com as escolhas do Sandro de 24/11/2026)
- **Tarefa:** M6-05

## Contexto

O Sandro escolheu rodar a produção na própria VPS02, ao lado do teste e da Ratoeira, sem contratar servidor novo, e
manter o Backblaze na conta grátis. A spec pede tudo da produção separado do teste, publicação só com o clique dele,
backup antes de trocar a versão e migrações que não quebram a versão que está no ar.

## Decisão

1. **Mesma receita, outra pasta.** A produção fica em `/opt/mago-os-producao`, com projeto do compose próprio
   (`mago-os-producao`): banco, antivírus, redes, volumes, portas (3201 e 3202) e Caddy próprios, e limites de memória
   e de CPU em cada container. Os scripts do servidor são os mesmos do teste: cada um lê o `ambiente.conf` da pasta
   dele e, sem ele, usa os padrões do teste (os nomes do teste não mudam).
2. **Segredos num projeto do Infisical só da produção** (`mago-os-producao`), lido só pela identidade
   `vps02-producao`. A identidade do teste não alcança a produção (no plano grátis do Infisical, um projeto à parte é
   a forma de separar o acesso). Buckets próprios no Backblaze: backup e auditoria travados, anexos guardando por 30
   dias o que for apagado (para a M6-03).
3. **Publicação aprovada.** O fluxo "Publicação na produção" só roda quando pedido e espera a aprovação do Sandro
   (ambiente `producao` do GitHub, só da main, com ele como aprovador). Ele não monta imagem nova: marca como
   `:producao` a imagem que já passou pelo teste e pelo Trivy. A VPS02 confere a cada minuto (sem campainha: nada
   entra de fora), faz um backup incremental, migra, liga a versão nova ao lado da antiga e só desliga a antiga com a
   nova saudável.
4. **Migrações compatíveis.** A verificação de cada PR que muda migrações roda os testes da main contra o banco com
   as migrações do PR: se a versão que está no ar quebrar com o banco novo, o PR fica vermelho. Mudança que precisa
   quebrar (apagar ou renomear coluna) vai em dois passos: primeiro o código para de usar, depois a migração.
5. **Até o DNS.** O Caddy atende app.osmago.com com certificado próprio (`tls internal`) e só aceita pedidos da
   Cloudflare ou do próprio servidor (a regra fica dentro de um `route`, para rodar antes de qualquer resposta). Com
   o DNS (M6-05b), sai o `tls internal`.
6. **Recursos.** Um aviso a cada 5 minutos olha a VPS02 inteira: memória disponível abaixo de 1 GB, disco acima de
   80% ou os backups dos dois ambientes acima de 7 GB no Backblaze.

## O que foi descartado

- **Antivírus dividido com o teste:** economizaria cerca de 1 GB de memória, mas ligaria as redes dos dois
  ambientes.
- **Campainha também na produção:** precisaria de entrada de fora; conferir a cada minuto basta.
- **A mesma identidade do Infisical lendo os dois ambientes:** o teste alcançaria os segredos da produção.
