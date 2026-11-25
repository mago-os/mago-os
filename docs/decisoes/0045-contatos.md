# 0045 Contatos

- **Data:** 25/11/2026
- **Situação:** proposta (esperando o ok do Sandro)
- **Tarefa:** M7-01

## Contexto

A spec do M7, aprovada pelo Sandro em 25/11/2026, pede o cadastro único de contatos: pessoas e organizações de fora da empresa, com vários e-mails e telefones, que o WhatsApp (M8), o CRM (M9), o atendimento (M11) e o portal vão usar. As decisões 1 (pessoa e organização) e 2 (duplicados: o sistema só avisa e sugere juntar) já estão aprovadas. Esta nota acerta o que falta para construir, com os pontos que pedem o olho do Sandro marcados com **pede o seu olho**.

## Decisão

1. **O contato.** Dois tipos: pessoa e organização. Nome, papéis (lead, cliente, fornecedor, parceiro, outro, mais de um ao mesmo tempo; sem papel nasce como "outro"), etiquetas, responsável (pessoa da equipe; sem responsável, fica com quem criou), fuso, observações, CPF ou CNPJ (só os números) e situação (ativo, arquivado ou juntado). A pessoa se liga a até 10 organizações, com o cargo; na ficha da organização aparecem as pessoas ligadas.
2. **Identificadores.** Até 20 por contato: e-mails (em minúsculas), telefones no formato internacional (+55...), com a marca "tem WhatsApp" e um rótulo (celular, recepção), e redes (Instagram, LinkedIn, Facebook, TikTok, X, YouTube, site ou outra). Um e-mail e um telefone podem ser os principais. Na tela, o telefone brasileiro digitado sem o +55 é completado sozinho.
3. **Repetidos.** Um identificador repetido na mesma empresa não bloqueia: a resposta de criar e de editar traz o aviso "já existe em outro contato", e a tela mostra o botão "Juntar". Se o outro contato é de alguém que a pessoa não pode ver, o aviso diz só que ele existe, sem o nome (para não vazar o cadastro de outro vendedor).
4. **Juntar.** Só na tela, escolhendo o contato que fica. Ele recebe os identificadores, as organizações, os papéis, as etiquetas, as tarefas, os projetos e as pessoas ligadas do outro, e as observações dos dois são somadas. Nos campos que os dois têm (nome, documento, responsável, fuso), vale o do que fica. O outro não é apagado: vira "juntado", some das listas e leva ao que ficou quem abrir o endereço antigo. Tudo numa transação, com auditoria.
5. **Etiquetas.** As mesmas etiquetas da empresa que marcam as tarefas, para não haver duas listas. **Pede o seu olho:** a alternativa é uma lista de etiquetas só dos contatos.
6. **Tarefas e projetos.** Uma tarefa ou um projeto cita até 20 contatos. A ficha do contato mostra as tarefas abertas e fechadas ligadas a ele (as que a pessoa pode ver), e a lista de tarefas ganha o filtro por contato. A tarefa e o projeto mostram os contatos ligados, com a escolha por busca.
7. **Permissões** (módulo novo `contatos`, sem área, sem dado sensível). Ações: ver, criar, editar (inclui arquivar), aprovar (é o **juntar**) e excluir (apagar). Padrão:
   - Administrador: tudo.
   - Gestor de área: vê, cria, edita e junta todos (como nos projetos). Não apaga.
   - Funcionário: vê, cria e edita os **seus**: aqueles de que é responsável, que criou, ou ligados a um projeto de que é membro. **Pede o seu olho:** a spec não fala de "que criou"; eu incluí para quem cadastra um contato não perder o acesso a ele quando escolhe outro responsável.
   - O administrador ajusta por pessoa, como nos outros módulos (por exemplo, o atendimento vendo todos).
8. **Apagar.** Só o administrador, só na tela, com a confirmação do segundo fator (como excluir projeto). Apaga o contato e os identificadores, tira das tarefas e projetos, e a auditoria guarda só o id. É o caminho para o pedido de exclusão da LGPD.
9. **Busca.** A busca geral (Ctrl+K) ganha o grupo "Contatos", pelo nome, e-mails, telefones (com ou sem o +55) e redes, sem acento e aceitando erro de digitação, com a mesma permissão da lista.
10. **Visões salvas.** Como nas tarefas: cada pessoa guarda os filtros da lista de contatos com um nome, e elas aparecem no menu. Ficam numa tabela própria.
11. **Ferramentas dos agentes** (regra 12): `listar_contatos`, `ver_contato`, `criar_contato`, `atualizar_contato` e `ligar_contato`, nos agentes internos (com a permissão de quem pediu) e no MCP (com a permissão do responsável pelo agente). Todas executam por padrão, porque não falam com ninguém de fora; o administrador pode mudar para "pede aprovação" por agente. Juntar e apagar entram na lista de alto risco ("só em Contatos"), e o prefixo `juntar` passa a ser barrado em qualquer ferramenta.
12. **Auditoria.** `contato.criou`, `contato.editou`, `contato.arquivou`, `contato.desarquivou`, `contato.juntou`, `contato.apagou`, `contato.ligou_tarefa` e `contato.ligou_projeto`. Nos detalhes vão ids e os nomes dos campos que mudaram, nunca nome, e-mail, telefone ou documento.
13. **Isolamento.** Tabelas `contatos`, `identificadores_de_contato`, `contatos_em_organizacoes`, `etiquetas_de_contato`, `contatos_de_tarefa`, `contatos_de_projeto` e `visoes_de_contatos`, todas com `empresa_id`, RLS e marcas (`[pessoal]` no nome, nos identificadores, no documento e nas observações). Uma empresa nunca vê nem liga contato da outra; o teste de vazamento da M6-01 cobre as rotas novas.

## O que foi descartado

- **Bloquear e-mail ou telefone repetido:** recusado na decisão 2 (recepção, família, contato@).
- **Juntar sozinho ou por agente:** nunca; a decisão é humana.
- **Importar de planilha e de outras ferramentas:** M13.
- **Contato como participante de evento da agenda:** fica para o M13, com o Google Agenda.

## Consequências

- Contratos: `contratos/src/contatos/contatos.ts` (contato, identificadores, pedidos de criar, editar, juntar e ligar, filtro, visão salva, aviso de repetido e as ações de auditoria); `contatoId` no filtro das tarefas; as cinco ferramentas nos internos e no MCP, com as assinaturas congeladas; as regras no catálogo de ações; "juntar ou apagar contatos" no alto risco.
- Telas: Contatos no menu (lista, ficha, juntar), escolha de contatos na tarefa e no projeto, e o grupo Contatos na busca.
- Pronto quando: a 4xpert cadastra uma organização e duas pessoas dela, liga uma tarefa a elas, vê a tarefa na ficha, cadastra um e-mail repetido, recebe o aviso e junta os dois; e o coordenador responde "qual o telefone da Ana da Acme?" pelo `listar_contatos`.
