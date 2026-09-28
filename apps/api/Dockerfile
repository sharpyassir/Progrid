# Control plane API and Temporal worker. One image, two commands:
#   api:    node dist/main.js
#   worker: node dist/worker.js
# Build from the workspace root:  docker build -f apps/api/Dockerfile -t prgd-api .
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/openapi/package.json packages/openapi/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN pnpm install --frozen-lockfile --filter @prgd/api...
COPY apps/api apps/api
RUN pnpm --filter @prgd/api prisma:generate && pnpm --filter @prgd/api build
# Self contained copy of the api package with its dependencies (dev deps kept for the prisma CLI and seed),
# then the Prisma client is generated inside that copy so the runtime image needs no build step.
RUN pnpm --filter @prgd/api deploy --legacy /out && cp -r apps/api/dist /out/dist && cp -r apps/api/prisma /out/prisma && cp -r apps/api/assets /out/assets \
    && cd /out && node node_modules/prisma/build/index.js generate

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 prgd
WORKDIR /app
COPY --from=build --chown=prgd:prgd /out /app
ENV NODE_ENV=production PORT=4000
USER prgd
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:4000/healthz || exit 1
CMD ["node", "dist/main.js"]
