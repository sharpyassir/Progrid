# Next.js standalone build. Build from the workspace root:
#   docker build -f apps/console/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t pgcloud-console .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/console/package.json apps/console/
COPY packages/openapi/package.json packages/openapi/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN pnpm install --frozen-lockfile --filter @pgcloud/console...
COPY apps/console apps/console
# Public addresses are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_CONSOLE_URL=http://localhost:3000
ARG NEXT_PUBLIC_WWW_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_CONSOLE_URL=$NEXT_PUBLIC_CONSOLE_URL NEXT_PUBLIC_WWW_URL=$NEXT_PUBLIC_WWW_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pgcloud/console build

FROM node:22-bookworm-slim
RUN useradd -r -u 10001 pgcloud
WORKDIR /app
COPY --from=build --chown=pgcloud:pgcloud /app/apps/console/.next/standalone ./
COPY --from=build --chown=pgcloud:pgcloud /app/apps/console/.next/static ./apps/console/.next/static
COPY --from=build --chown=pgcloud:pgcloud /app/apps/console/public ./apps/console/public
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
USER pgcloud
EXPOSE 3000
CMD ["node", "apps/console/server.js"]
