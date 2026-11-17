# 0009 Login por e-mail e senha com o Better Auth

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat, "aprovado", em 17/11/2026)
- **Tarefa:** M1-03

## Contexto

A spec pede login por e-mail e senha com o Better Auth, bloqueio de senhas vazadas, trava após várias tentativas erradas e recuperação de senha por e-mail. A M1-02 já criou a tabela `pessoas` (um e-mail, um login) e o isolamento entre empresas.

## Decisão

1. **Better Auth 1.7** dentro da API, em `/api/acesso/*` (`nucleo/src/acesso/`). As tabelas dele são as do Mago OS, com nomes em português: o "user" é `pessoas`; contas, sessões, links e limites ficam no esquema `acesso` (`credenciais`, `sessoes`, `verificacoes`, `limites`, `travas`). Um cadastro só.
2. **Papel próprio no banco, `mago_acesso`:** lê as pessoas, altera só nome, foto, e-mail verificado e data, e mexe só no esquema `acesso`. Não vê empresas nem vínculos; a empresa inicial da sessão vem da função `acesso.empresa_inicial`, que devolve só o identificador. O papel da API das empresas (`mago_app`) não enxerga o esquema `acesso`. Senha do papel e segredo dos cookies no Infisical (`MAGO_DB_SENHA_ACESSO` e `MAGO_ACESSO_SEGREDO`).
3. **Sem cadastro aberto:** a pessoa entra por convite (M1-07) ou pelo comando de início. O primeiro acesso é um link para definir a senha (`pnpm plataforma:senha --email`), que aparece só no terminal de quem roda o comando no servidor.
4. **Senha:** de 10 a 128 caracteres, sem exigir símbolo. Guardada com scrypt (padrão do Better Auth). Senhas que aparecem no Have I Been Pwned são recusadas ao definir ou trocar; só os 5 primeiros caracteres do SHA-1 saem do servidor. Só o Mac pode desligar a checagem (`MAGO_SENHAS_VAZADAS=nao_conferir`).
5. **Trava:** 5 senhas erradas seguidas travam o e-mail por 15 minutos (tabela `acesso.travas`, conferida pela API antes do Better Auth). Vale para e-mails sem conta, e a resposta de "e-mail não existe" é igual à de "senha errada". Além disso, cada IP faz no máximo 10 tentativas de entrar por minuto (limite do Better Auth guardado no banco, porque a API não guarda estado).
6. **Sessão:** 7 dias, renovada uma vez por dia enquanto a pessoa usa, em cookie `HttpOnly` e `Secure` (fora do Mac). Trocar a senha pelo link derruba todas as sessões. Pessoa bloqueada não abre sessão.
7. **Links de senha:** valem 1 hora, uso único, e o banco guarda só a impressão digital do código.
8. **E-mail:** o Resend entra numa tarefa própria (precisa da conta e de uma mudança no DNS, com o Sandro). Até lá, no Mac e no teste, o link de recuperação vai para o log da API; na produção, a recuperação recusa em vez de mandar o link para o log.
9. **Registros:** entrar, sair, errar, travar e pedir recuperação vão para o log com o nome padronizado do evento (`acesso.entrou`, `acesso.falhou`...). A M1-09 passa a gravá-los na auditoria encadeada.
10. **Telemetria do Better Auth desligada:** nada sobre o uso sai do servidor.

## Descartado

- **Tabelas padrão do Better Auth no esquema public:** ficariam misturadas com os dados das empresas e com o isolamento por empresa, que não se aplica a senha e sessão.
- **Dar ao login o mesmo papel da API (`mago_app`):** ele precisaria enxergar todas as pessoas sem empresa ativa, furando o isolamento.
- **Argon2:** precisa de compilação nativa (scripts de instalação bloqueados no projeto). O scrypt é seguro e já vem no Better Auth.
- **Trava só por IP:** quem tenta de vários IPs passaria. Por isso há as duas: por e-mail e por IP.

## Consequências

- A API não sobe no teste nem na produção sem a configuração do login (`DATABASE_URL_ACESSO`, `MAGO_ACESSO_SEGREDO`, `MAGO_URL_PUBLICA`).
- O Better Auth confere na subida se as tabelas batem com o que ele espera; uma migração esquecida derruba a subida, e a versão antiga continua no ar.
- As mensagens de erro do Better Auth vêm em inglês, com um código. As telas (M1-10) mostram o texto em português a partir do código.
