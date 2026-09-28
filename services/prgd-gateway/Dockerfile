# Terminal gateway of the DevOps console (WebSocket to SSH).
# Build from the workspace root:  docker build -f services/prgd-gateway/Dockerfile -t prgd-gateway .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY services/prgd-gateway/package.json services/prgd-gateway/
RUN pnpm install --frozen-lockfile --filter @prgd/gateway...
COPY services/prgd-gateway services/prgd-gateway
RUN pnpm --filter @prgd/gateway build
# Self contained copy with production dependencies only (ssh2 runs on node:crypto; its optional
# native addon is not built).
RUN pnpm --filter @prgd/gateway deploy --prod --legacy /out

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 prgd \
    && mkdir -p /var/lib/prgd-gateway/spool && chown -R prgd:prgd /var/lib/prgd-gateway && chmod 700 /var/lib/prgd-gateway/spool
WORKDIR /app
COPY --from=build --chown=prgd:prgd /out /app
ENV NODE_ENV=production PRGD_GATEWAY_PORT=4100 PRGD_GATEWAY_SPOOL_DIR=/var/lib/prgd-gateway/spool
USER prgd
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
