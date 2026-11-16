# 0004 Telas: React, Tailwind, shadcn, app instalável e o mago

- **Data:** 16/11/2026
- **Situação:** aceita
- **Tarefa:** M0-06

## Contexto

A spec pede a tela inicial em React, Vite, Tailwind e shadcn, no estilo monocromático do design aprovado (`mago-os-design.html`, proposta v2), com tema claro e escuro, pensada primeiro para o celular, instalável como app (PWA) e mostrando o estado da API.

## Decisão

1. **Cores e fontes do design aprovado** viram variáveis CSS (`telas/src/estilo.css`) e, a partir delas, classes do Tailwind 4 em português (`bg-tinta`, `text-texto-2`, `border-linha`, `bg-agente`...). A cor secundária é corrigida sozinha para manter o contraste nos dois temas, como no design.
2. **shadcn** no formato "copiar o componente para o projeto" (`telas/src/componentes/ui`), ajustado às cores do Mago OS. Componentes novos entram pelo mesmo caminho (`components.json` já configurado).
3. **Fonte Geist** guardada junto com o app (pacotes `@fontsource-variable`), sem chamar o Google Fonts: abre sem internet e não entrega o IP do usuário a terceiros.
4. **Tema:** automático (segue o aparelho), claro ou escuro, num botão no topo. A escolha fica só naquele navegador.
5. **O mago em meio-tom** é o mesmo desenho do design aprovado, portado para TypeScript (`desenho-do-mago.ts`), num canvas a 30 quadros por segundo, parado para quem pediu menos movimento no aparelho e pausado quando sai da tela. Os ícones do app são gerados a partir dele (`pnpm icones`).
6. **App instalável** com `vite-plugin-pwa`: manifesto, ícones (inclusive o recortável do Android) e um service worker que atualiza sozinho. A API nunca vem do cache.
7. **A tela chama a API em `/api`.** No Mac, o Vite repassa para a porta 3000; em teste e produção, o Caddy faz o mesmo (M0-10). Assim tela e API ficam no mesmo endereço, sem configuração de CORS.
8. **No Mac, a tela roda fora do container** (`pnpm dev`): o Vite 8 usa um programa nativo do Mac que não roda no Linux do container. O banco e a API continuam em containers.

## Descartado

- **Next.js:** o Mago OS é um app atrás de login, sem necessidade de páginas renderizadas no servidor; Vite é mais simples e mais rápido.
- **Bibliotecas de componentes prontas (MUI, Chakra):** difíceis de deixar com a cara do design aprovado.
- **Avatar 3D ou vídeo para o mago:** pesado; o plano pede algo leve que rode no celular.

## Consequências

- Os testes de tela com Playwright entram no M0-07. O Playwright já está instalado (usado para gerar os ícones).
- O botão "Instalar app" aparece sozinho nos navegadores que permitem (Chrome e Android). No iPhone, a instalação é pelo "Adicionar à Tela de Início" do Safari.
