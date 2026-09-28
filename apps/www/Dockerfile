# Next.js standalone build. Build from the workspace root:
#   docker build -f apps/www/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t pgcloud-www .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/www/package.json apps/www/
COPY packages/openapi/package.json packages/openapi/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN pnpm install --frozen-lockfile --filter @pgcloud/www...
COPY apps/www apps/www
COPY packages/openapi/openapi.yaml packages/openapi/openapi.yaml
# Public addresses are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_CONSOLE_URL=http://localhost:3000
ARG NEXT_PUBLIC_WWW_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_CONSOLE_URL=$NEXT_PUBLIC_CONSOLE_URL NEXT_PUBLIC_WWW_URL=$NEXT_PUBLIC_WWW_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pgcloud/www build

FROM node:22-bookworm-slim
RUN useradd -r -u 10001 pgcloud
WORKDIR /app
COPY --from=build --chown=pgcloud:pgcloud /app/apps/www/.next/standalone ./
COPY --from=build --chown=pgcloud:pgcloud /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=build --chown=pgcloud:pgcloud /app/apps/www/public ./apps/www/public
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
USER pgcloud
EXPOSE 3001
CMD ["node", "apps/www/server.js"]
