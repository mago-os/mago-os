# Spec da Fase 1: M1 Acesso

Parte da [spec da Fase 1](README.md). Estado em 17/11/2026: em andamento (M1-01 em revisão).

**Pronto quando:** o Sandro entra em teste.osmago.com com Google e passkey, convida um funcionário de teste, vê e encerra sessões, e cada uma dessas ações aparece na auditoria. Os testes provam que uma empresa não vê dados da outra.

| Número | Tarefa | Depende de | Tamanho |
| --- | --- | --- | --- |
| M1-01 | Contratos de identidade | M0 | P |
| M1-02 | Empresas e uma pessoa em várias empresas | M1-01 | M |
| M1-03 | Login por e-mail e senha | M1-01 | M |
| M1-04 | Login com Google | M1-03 | P |
| M1-05 | Autenticação em 2 fatores | M1-03 | M |
| M1-06 | Perfis e permissões por módulo | M1-02 | M |
| M1-07 | Convites e desligamento | M1-03, M1-06 | M |
| M1-08 | Sessões e aparelhos | M1-03 | M |
| M1-09 | Auditoria à prova de alteração | M1-01 | M |
| M1-10 | Telas de acesso | M1-03 a M1-08 | M |

### M1-01 Contratos de identidade

- [x] Definir na pasta de contratos os formatos de pessoa, empresa, vínculo (pessoa numa empresa, com perfil), sessão e evento de auditoria
- [x] Aprovação do Sandro (é contrato): aprovado em 17/11/2026, ver [decisão 0008](../decisoes/0008-contratos-com-typebox.md)

Pronto quando: os formatos estão aprovados e as outras tarefas usam só eles.

### M1-02 Empresas e uma pessoa em várias empresas

- [ ] Criar a empresa Nolask e o Sandro como Dono da plataforma
- [ ] Estrutura para o mesmo login estar em várias empresas, cada uma com as próprias permissões (o seletor completo fica para a Fase 2)
- [ ] A empresa ativa vai junto em cada pedido e o banco só mostra dados dela
- [ ] Teste de vazamento com duas empresas e uma pessoa nas duas

Pronto quando: a mesma pessoa em duas empresas nunca vê dados de uma na outra.

### M1-03 Login por e-mail e senha

- [ ] Better Auth com e-mail e senha
- [ ] Bloqueio de senhas que já vazaram na internet e trava após várias tentativas erradas
- [ ] Recuperação de senha por e-mail (depende do provedor de e-mail, ver perguntas)

Pronto quando: entrar, sair e recuperar a senha funcionam, e a trava age após as tentativas erradas.

### M1-04 Login com Google

- [ ] Configurar o login Google no console do Google (com o Sandro)
- [ ] O convite fica ligado ao e-mail: quem entra com Google precisa usar a conta daquele e-mail
- [ ] Pedir só nome, e-mail e foto

Pronto quando: o Sandro entra com a conta Google dele.

### M1-05 Autenticação em 2 fatores

- [ ] App autenticador e passkey
- [ ] Obrigatório para Dono da plataforma e Administrador; o admin pode exigir de todos
- [ ] Códigos de recuperação e "confiar neste aparelho por 30 dias"

Pronto quando: o Sandro entra com passkey, e um admin sem 2FA não consegue entrar.

### M1-06 Perfis e permissões por módulo

- [ ] Perfis Dono da plataforma, Administrador, Gestor de área e Funcionário
- [ ] Ajuste por módulo: ver, criar, editar, aprovar e excluir, com alcance "tudo", "da minha equipe" ou "só meus itens"
- [ ] Uma verificação central no núcleo, usada por todas as rotas
- [ ] Testes para cada perfil

Pronto quando: um funcionário de teste é barrado no que não foi liberado para ele.

### M1-07 Convites e desligamento

- [ ] Admin convida por e-mail, a pessoa aceita e define senha ou entra com Google
- [ ] Desligar uma pessoa corta tudo na hora: login, sessões e chaves ligadas a ela

Pronto quando: a pessoa desligada perde o acesso no mesmo instante, em todos os aparelhos.

### M1-08 Sessões e aparelhos

- [ ] Lista de aparelhos conectados, com desconectar um ou todos
- [ ] Sessão expira por inatividade
- [ ] Alerta de login em aparelho novo

Pronto quando: o Sandro desconecta o celular pelo computador e o celular sai na hora.

### M1-09 Auditoria à prova de alteração

- [ ] Registro de quem fez o quê, quando e de onde, incluindo agentes
- [ ] Cada registro encadeado ao anterior, para que qualquer alteração seja percebida
- [ ] Cópia guardada fora do alcance de quem administra o sistema
- [ ] Consulta simples para o administrador

Pronto quando: alterar um registro à mão no banco é detectado pela verificação.

### M1-10 Telas de acesso

- [ ] Entrar, 2FA, aceitar convite, meu perfil, minhas sessões e usuários da empresa
- [ ] Pensadas primeiro para o celular, no design aprovado
- [ ] Testes de tela com Playwright

Pronto quando: o fluxo inteiro do "Pronto quando" do M1 funciona pelo celular.

