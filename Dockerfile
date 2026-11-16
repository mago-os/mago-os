# Imagem do Mago OS (M0-10): a API (núcleo) e a versão construída da tela, numa imagem só.
# Montada pelo GitHub a cada mudança aprovada e guardada de forma privada em ghcr.io/mago-os/mago-os.
# Na VPS, a API roda desta imagem e o Caddy serve a tela, copiada de /app/telas (ver infra/vps02/bin/publicar.sh).

FROM node:26-slim AS base
ENV CI=true
RUN npm install -g pnpm@11.22.0 --no-fund --no-audit
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY nucleo/package.json nucleo/
COPY contratos/package.json contratos/
COPY telas/package.json telas/
COPY testes/package.json testes/

# Tela: instala tudo e monta a versão de produção.
FROM base AS tela
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @mago-os/telas construir

# Núcleo: só as bibliotecas de produção do núcleo e dos pacotes que ele usa (contratos). Os pacotes do
# próprio repositório ficam como links, fora de node_modules, porque o Node roda o TypeScript deles direto.
FROM base AS nucleo
RUN pnpm install --frozen-lockfile --prod --filter "@mago-os/nucleo..."
COPY contratos/ contratos/
COPY nucleo/ nucleo/

FROM node:26-slim
ARG MAGO_VERSAO=desconhecida
ENV NODE_ENV=production MAGO_VERSAO=$MAGO_VERSAO PORTA=3000 HOST=0.0.0.0
LABEL org.opencontainers.image.source="https://github.com/mago-os/mago-os" \
      org.opencontainers.image.description="Mago OS: API e tela" \
      org.opencontainers.image.revision=$MAGO_VERSAO
WORKDIR /app/nucleo
COPY --from=nucleo /app /app
COPY --from=tela /app/telas/dist /app/telas
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Migrações: docker run --rm -e DATABASE_URL_DONO=... <imagem> node src/migrar.ts subir
CMD ["node", "--import", "./src/rastreio.ts", "src/iniciar.ts"]
