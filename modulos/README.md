# Módulos

Um pacote por módulo (CRM, financeiro e outros), cada um em `modulos/<nome>/` com o nome `@mago-os/modulo-<nome>`.

Regras:

- Um módulo só fala com outro pelos contratos (`@mago-os/contratos`), nunca importando o código do outro.
- Uma tarefa de módulo mexe só na pasta daquele módulo.
- O primeiro módulo chega no M3 (projetos e tarefas).
