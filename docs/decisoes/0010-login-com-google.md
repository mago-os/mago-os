# 0010 Login com Google

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026)
- **Tarefa:** M1-04

## Contexto

A spec pede o login com Google, com o convite ligado ao e-mail e pedindo só nome, e-mail e foto. O login por e-mail e senha da M1-03 já usa o Better Auth ([decisão 0009](0009-login-com-better-auth.md)).

## Decisão

1. **Provedor Google do Better Auth**, ligado só quando `MAGO_GOOGLE_ID` e `MAGO_GOOGLE_SEGREDO` existem (Infisical). Sem eles, a API sobe só com e-mail e senha.
2. **Sem cadastro pelo Google** (`disableSignUp`): uma conta Google desconhecida não cria pessoa e volta para a tela de entrar com um código de erro.
3. **Ligação só com o mesmo e-mail, confirmado dos dois lados:** o Google precisa marcar o e-mail como confirmado, e a pessoa no Mago OS também (`email_verificado`). Contas com e-mails diferentes nunca se ligam. O e-mail fica confirmado no Mago OS quando a pessoa usa um link mandado a ele (recuperação de senha e, na M1-07, o convite) ou, no caso do Dono da plataforma, pelo comando de início, em que ele digita o próprio e-mail.
4. **Só nome, e-mail e foto** (escopos `openid`, `email` e `profile`), com `prompt=select_account`, para a pessoa escolher a conta certa. O nome no Mago OS não é trocado pelo do Google.
5. **Mesmas regras da senha** para sessão, pessoa bloqueada, limite por minuto (10 por IP) e registros.
6. **Endereço de volta:** `https://<site>/api/acesso/callback/google`, cadastrado no cliente OAuth do Google (projeto "Mago OS" no Google Cloud, criado pelo Sandro). Cada ambiente novo (produção) precisa do seu endereço cadastrado.

## Descartado

- **Ligar contas pelo e-mail sem confirmação no Mago OS:** abriria a porta para alguém cadastrar um e-mail alheio e "receber" o login Google da vítima.
- **Pedir mais permissões ao Google (agenda, Drive):** nada disso é usado no login; se um módulo precisar, pede à parte.

## Consequências

- O teste automático troca só a resposta do Google por uma falsa, no ponto em que o código vira token; o caminho do Mago OS é o real.
- A tela de entrar (M1-10, ou a versão simples antes dela) mostra o texto do erro a partir do código que volta em `?error=`.
