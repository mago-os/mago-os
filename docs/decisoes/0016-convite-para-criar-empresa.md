# 0016 Convite para criar empresa

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026)
- **Tarefa:** M1-11

## Contexto

Até a M1-07, toda conta nova nascia pelo comando `plataforma:iniciar`, que fazia o Sandro administrador dela. Isso obrigava o Sandro a ter os dados de cada cliente e o colocava dentro de contas que não são dele. O Sandro pediu que o primeiro usuário de cada conta crie a conta pelo link e vire administrador, e que a conta possa ser de uma empresa (CNPJ) ou de uma pessoa física (CPF), porque alguns clientes não têm empresa aberta.

## Decisão

1. **Convite do Dono:** tela "Empresas", só para o Dono da plataforma. Ele informa o nome e o e-mail do responsável. O link vale 7 dias, funciona uma vez só e o banco guarda só a impressão digital do código (`acesso.convites_de_empresa`). Reenviar troca o link; cancelar desfaz.
2. **Pelo link (`/nova-conta`):** quem ainda não tem acesso cria a senha e os dados da conta na mesma tela, ou usa "Continuar com Google" (ajuste de 17/11/2026, pedido do Sandro): a pessoa do convite passa a existir com o e-mail confirmado (`/acesso/convite-de-empresa/preparar-google`), o Google liga a conta dele a ela só se for o mesmo e-mail, e a tela volta com a pessoa conectada para preencher os dados; quem já tem entra antes (e volta para o link). O e-mail da sessão precisa ser o do convite. Tudo numa transação: se o documento já tiver conta, nada fica pela metade (nem a senha).
3. **Dados pedidos:** obrigatórios só o nome de exibição e o fuso (que vem do navegador), por decisão do Sandro em 17/11/2026, depois do primeiro teste. Num bloco "Dados para nota fiscal (pode preencher depois)" ficam, opcionais: tipo (empresa ou pessoa física), CNPJ ou CPF conferido pelos dígitos verificadores quando informado (o CNPJ aceita o formato novo, com letras), razão social ou nome completo e telefone. O idioma vem do navegador. O documento passa a ser obrigatório na cobrança (Fase 2), antes da primeira fatura, e no teste grátis com cadastro aberto. Endereço, inscrição estadual e dados de cobrança ficam para o módulo de cobrança.
4. **Um documento, uma conta:** o banco não deixa repetir o documento. As contas criadas antes (como a 4xpert) ficam sem documento até o administrador completar (tarefa futura, "Dados da empresa").
5. **Quem cria vira administrador.** O Dono não entra na conta: vê só o cadastro (nome, tipo, documento, situação, data e quantas pessoas), pela função `acesso.empresas_da_plataforma`, que confere que quem pede é o Dono.
6. **CPF é dado pessoal (LGPD):** a coluna leva a marca `[pessoal]`; nas telas, para quem não é administrador nem Dono, aparece mascarado (`mascararDocumento`, nos contratos).
7. **Auditoria:** `empresa.convidou`, `empresa.reenviou_convite` e `empresa.cancelou_convite` na corrente da plataforma; `empresa.criou` na corrente da conta nova.
8. O comando `plataforma:iniciar` continua como plano B.

## Descartado

- **Cadastro aberto (qualquer um cria uma conta):** fica para a Fase 2, junto com planos e cobrança (repositório `mago-os-cloud`).
- **O Dono preencher os dados da conta:** ele não tem os dados e não deve estar dentro das contas dos clientes.
- **Pedir endereço e dados fiscais já no cadastro:** só servem para a nota fiscal; pedir cedo afasta quem está começando.

## Consequências

- O contrato `Empresa` ganha tipo, documento, nome legal, fuso, idioma e telefone.
- O Dono precisa do 2FA completo para usar a tela "Empresas" (já é obrigatório para ele).
