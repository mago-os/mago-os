# 0015 Convites e desligamento

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026)
- **Tarefa:** M1-07

## Contexto

A spec pede que o administrador convide por e-mail, que a pessoa aceite e defina a senha (ou entre com o Google), e que desligar alguém corte tudo na hora. "Pronto quando": a pessoa desligada perde o acesso no mesmo instante, em todos os aparelhos. Até aqui, a única forma de pôr alguém numa empresa era o comando `plataforma:iniciar` e os e-mails iam para o log.

## Decisão

1. **E-mail pelo Resend:** domínio `osmago.com` (região São Paulo), remetente `Mago OS <nao-responda@osmago.com>`, chave só de envio em `MAGO_RESEND_CHAVE` (Infisical). Sem a chave (no Mac e nos testes), os links vão para o log, como antes; na produção, sem chave, o envio é recusado. O convite e a recuperação de senha usam o mesmo carteiro.
2. **Convite:** `POST /api/empresa/convites`, com a permissão `pessoas.criar` (padrão: o administrador). Nome, e-mail, perfil e área; gestor precisa de área. Um e-mail é uma pessoa só no sistema inteiro: se ela já existe (de outra empresa), ganha só o vínculo novo, com o nome que já tinha. Quem foi desligado pode ser convidado de novo. Quem já está na empresa (ativo ou convidado) é recusado.
3. **Link:** código aleatório de 32 bytes; o banco guarda só a impressão digital (SHA-256) em `acesso.convites`. Vale 7 dias e funciona uma vez só. Reenviar troca o link (o anterior para de valer) e cancelar desfaz o convite. Limite de 30 convites por hora por pessoa, para o sistema não virar ferramenta de spam.
4. **Aceitar (`/convite?codigo=...`):** quem ainda não tem conta define a senha ali mesmo ou usa "Continuar com Google" com a conta do e-mail convidado (ajuste de 17/11/2026) (mesmas regras: 10 a 128 caracteres e conferência de senhas vazadas) e depois entra. Quem já tem conta entra antes (senha, passkey ou Google, e a tela volta para o convite) e aceita; o convite precisa ser do mesmo e-mail da sessão. Abrir um link válido conta como e-mail confirmado, o que permite também entrar com o Google desse e-mail.
5. **Desligar:** `POST /api/empresa/pessoas/:vinculo/desligar`, com a permissão `pessoas.excluir`. O vínculo fica "desligado" e `empresa_ativa()` deixa de mostrar a empresa na hora. Se a pessoa não tem outra empresa, todas as sessões dela são apagadas (sai de todos os aparelhos); se tem, as sessões só deixam esta empresa. Ninguém desliga a si mesmo, e a empresa nunca fica sem administrador (o banco garante). O histórico continua na auditoria.
6. **Banco:** a API das empresas continua sem gravar direto em pessoas e vínculos: `convidar`, `cancelar_convite` e `desligar_vinculo` rodam como dono, só para a empresa ativa do pedido. Aceitar passa por funções do login (`acesso.abrir_convite`, `acesso.aceitar_convite`, `acesso.pessoa_do_convite`). Ver [banco, seção 15](../banco/decisoes.md).
7. **Auditoria:** `vinculo.convidou`, `vinculo.reenviou_convite`, `vinculo.cancelou_convite`, `vinculo.aceitou` e `vinculo.desligou`, sem o e-mail nos detalhes.
8. **Telas:** em Pessoas, "Convidar pessoa", e na ficha de cada um "Reenviar" e "Cancelar" (convite pendente) e "Desligar" (com confirmação). Tela pública de aceitar o convite.

## Descartado

- **Guardar o código do convite no banco:** quem lesse o banco poderia aceitar convites alheios. Fica só a impressão digital, como no link de senha.
- **Criar a conta com o Better Auth (sign-up):** o cadastro aberto continua desligado; a senha do convidado é gravada pela rota do convite, que confere o código antes.
- **Desligar apagando a pessoa:** a pessoa pode estar em outras empresas e a auditoria precisa do histórico.

## Consequências

- Na VPS02, o `segredos.sh` passa a levar `MAGO_RESEND_CHAVE` para o `api.env` (e as do Google, que já estavam no Infisical).
- O aviso de aparelho novo por e-mail (M1-08) fica para depois: hoje ele aparece no próprio Mago OS.
