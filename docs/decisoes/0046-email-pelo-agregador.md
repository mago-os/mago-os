# 0046 E-mail dos clientes pelo agregador

- **Data:** 25/11/2026
- **Situação:** aceita (decisão do Sandro no chat em 25/11/2026)
- **Tarefa:** M7-06 (o uso vem no M13)

## Contexto

Para o Mago OS ler o Gmail de outras empresas, o Google trata o acesso como restrito: além da verificação do app,
pede a avaliação de segurança CASA, feita por um laboratório autorizado, de US$ 500 a 4.500 por ano, em 2 a 6
semanas, refeita a cada 12 meses. Só enviar e-mail não exige a avaliação. O plano já citava agregadores como o
Composio, que têm o próprio app verificado no Google e entregam a conexão aos agentes por MCP.

## Decisão

1. O acesso ao e-mail dos clientes (Gmail e as outras contas) vai **só por um agregador**, o Composio ou um
   concorrente dele, usando o app já verificado do agregador. A verificação e a avaliação anual ficam com ele.
2. O agregador é usado **pelo núcleo** (os agentes pedem ao núcleo, com as mesmas permissões, aprovações e
   auditoria), para poder ser trocado sem mudar o resto.
3. **Criar o nosso próprio app verificado no Google** fica como recomendação para quando o Mago OS chegar ao
   **centésimo cliente pagante**.

## Consequências

- A tela de permissão do Google mostra o nome do agregador, não o do Mago OS.
- O conteúdo dos e-mails passa pelos servidores do agregador: entra na Política de Privacidade e nos contratos
  com os clientes (LGPD) antes de ligar o recurso.
- Na escolha do agregador (M13), conferir preço, limites da conta compartilhada, onde ficam os dados e se ele
  aceita só os escopos necessários.
- O login com Google do Mago OS (M1) continua com o nosso app, que só pede nome, e-mail e foto.
