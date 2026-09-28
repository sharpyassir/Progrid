# Next.js standalone build of the DevOps console (ops.progrid.sa). Build from the workspace root:
#   docker build -f apps/ops/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_OPS_URL=https://ops.example.com --build-arg NEXT_PUBLIC_GATEWAY_URL=wss://gateway.example.com -t prgd-ops .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/ops/package.json apps/ops/
COPY packages/openapi/package.json packages/openapi/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN pnpm install --frozen-lockfile --filter @prgd/ops...
COPY apps/ops apps/ops
# Public addresses are baked into the browser bundle and the Content Security Policy at build time:
# connections are allowed only to this app, the API and the terminal gateway.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_OPS_URL=http://localhost:3002
ARG NEXT_PUBLIC_GATEWAY_URL=ws://localhost:4100
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_OPS_URL=$NEXT_PUBLIC_OPS_URL NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @prgd/ops build

FROM node:22-bookworm-slim
RUN useradd -r -u 10001 prgd
WORKDIR /app
COPY --from=build --chown=prgd:prgd /app/apps/ops/.next/standalone ./
COPY --from=build --chown=prgd:prgd /app/apps/ops/.next/static ./apps/ops/.next/static
COPY --from=build --chown=prgd:prgd /app/apps/ops/public ./apps/ops/public
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
USER prgd
EXPOSE 3002
CMD ["node", "apps/ops/server.js"]
