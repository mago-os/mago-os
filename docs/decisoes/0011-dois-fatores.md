# 0011 Autenticação em 2 fatores: app autenticador, passkey e códigos

- **Data:** 17/11/2026
- **Situação:** aceita (proposta aprovada pelo Sandro no chat em 17/11/2026, com a confirmação de novo nas ações perigosas)
- **Tarefa:** M1-05

## Contexto

A spec pede 2FA com app autenticador e passkey, obrigatório para o Dono da plataforma e para administradores, com a opção de o administrador exigir de todos, códigos de recuperação e "confiar neste aparelho por 30 dias".

## Decisão

1. **Plugins do Better Auth:** `twoFactor` (app autenticador TOTP de 6 dígitos e 10 códigos de recuperação de uso único) e `@better-auth/passkey` (WebAuthn: Face ID, Touch ID, digital, Windows Hello, chave física ou celular por QR code). Tabelas `acesso.dois_fatores` e `acesso.passkeys`. O segredo do app e os códigos ficam criptografados com o segredo do login; das passkeys, só a chave pública.
2. **Cada sessão sabe se passou pelo segundo fator** (`acesso.sessoes.dois_fatores_em`). A sessão nasce confirmada quando acabou de passar pelo código, pelo código de recuperação, pela passkey ou por um aparelho confiável; numa sessão aberta, um código certo ou uma passkey cadastrada na hora também confirmam.
3. **Passkey vale como login completo:** ela já junta o aparelho e a biometria da pessoa.
4. **Quem precisa:** obrigatório (sem poder desligar) para o Dono da plataforma, para administradores ativos e para todos de uma empresa que marcou `exigir_dois_fatores` (`acesso.dois_fatores_obrigatorio`); quem ativou o app por conta própria também precisa a cada login, mas pode desligar. Quem precisa e ainda não tem segundo fator só consegue ativar; quem tem e ainda não confirmou só consegue confirmar. Nenhum dado aparece antes (`exigirSessaoCompleta`, usado por todas as rotas de dados a partir da M1-06).
5. **Vale também no login com Google:** o 2FA do Google não conta. O plugin cobre só o login por senha; para o Google, a regra do item 2 deixa a sessão "a confirmar", e o aparelho confiável é conferido pelo mesmo cookie do plugin.
6. **Confiar no aparelho:** 30 dias, cookie assinado com registro no banco (o mesmo do plugin).
7. **Ações perigosas** (trocar senha ou e-mail, ativar ou desligar o 2FA, gerar novos códigos, cadastrar ou apagar passkey) pedem o segundo fator de novo se o último foi há mais de 10 minutos, quando a pessoa já tem algum. Desligar o 2FA e apagar a última passkey são recusados quando o 2FA é obrigatório.
8. **Piso da plataforma e regras da empresa** (pedido do Sandro em 17/11/2026): toda empresa nasce com o padrão (2FA obrigatório para administradores, opcional para os demais), sem ninguém decidir nada na criação. O Dono decide o piso da plataforma inteira (`acesso.regras_da_plataforma`; hoje, "administradores e Dono só com passkey"); o administrador só pode **apertar** na empresa dele (`exigir_dois_fatores` e `exigir_passkey` para todos), nunca afrouxar abaixo do piso nem tirar o 2FA dos administradores. Com "só passkey", o código do app e o aparelho confiável não confirmam a sessão; o código de recuperação continua valendo como saída de emergência. Cada sessão guarda o método (`dois_fatores_metodo`). As telas de configuração ficam para a M1-10; até lá, as regras se ligam por comando no banco (manual de operação).
9. **Perdeu tudo:** `pnpm plataforma:desligar-2fa --email`, só no servidor, apaga app, passkeys, aparelhos confiáveis e sessões; a pessoa ativa de novo no próximo login.
10. **Tela:** versão simples (adiantada da M1-10): ativar com passkey (recomendado) ou app (QR code e os 10 códigos), pedir o código no login, e "Entrar com passkey".

## Descartado

- **Código por e-mail ou SMS como segundo fator:** SMS é fácil de desviar; e-mail ainda não existe (Resend). Pode entrar depois como reserva.
- **Exigir o 2FA de quem entra com passkey:** a passkey já é mais forte que senha mais código.
- **Exigir as duas formas (passkey e código) a cada login:** quase não soma segurança à passkey e aumenta o risco de a pessoa ficar trancada fora. No lugar, o piso "só passkey" (discutido com o Sandro em 17/11/2026).
- **Contar o 2FA do Google:** o Mago OS não tem como saber se ele foi feito, nem com que força.

## Consequências

- A passkey é presa ao endereço do site (`rpID` = domínio de `MAGO_URL_PUBLICA`). Ao mudar o domínio (produção), as passkeys do teste não servem lá: cada ambiente tem as suas.
- O teste automático calcula os códigos do app como o celular faz. A passkey de verdade é testada pelo Sandro; os testes cobrem as opções e as regras em volta dela.
