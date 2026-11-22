# syntax=docker/dockerfile:1.7
# 저장소 루트에서 빌드한다:  docker build -f packages/server/Dockerfile .
# linux/arm64 (Oracle Ampere A1)와 amd64 모두 동작한다. 네이티브 애드온 없음.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION=12.21.0
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/server/package.json packages/server/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wmg/server...
COPY packages/rules packages/rules
COPY packages/server packages/server
RUN pnpm --filter @wmg/server... build \
 && pnpm --filter @wmg/server deploy --prod --legacy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=2567
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# non-root
USER node
EXPOSE 2567
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
