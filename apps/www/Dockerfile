# Next.js standalone build. Build from the workspace root:
#   docker build -f apps/www/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t prgd-www .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/www/package.json apps/www/
COPY packages/openapi/package.json packages/openapi/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN pnpm install --frozen-lockfile --filter @prgd/www...
COPY apps/www apps/www
COPY packages/openapi/openapi.yaml packages/openapi/openapi.yaml
# Addresses come from the Host of each request at runtime (progrid.co or progrid.sa). These build
# time values are only the fallback for other hosts (previews, local runs).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_CONSOLE_URL=http://localhost:3000
ARG NEXT_PUBLIC_WWW_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_CONSOLE_URL=$NEXT_PUBLIC_CONSOLE_URL NEXT_PUBLIC_WWW_URL=$NEXT_PUBLIC_WWW_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @prgd/www build

# IP to country database for the progrid.co to progrid.sa redirect (DB-IP Lite, CC BY 4.0; the
# site footer carries the attribution). The deploy workflow passes the month so it refreshes monthly.
FROM debian:bookworm-slim AS geoip
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY infra/geoip/fetch-dbip.sh /fetch-dbip.sh
ARG GEOIP_MONTH=unset
RUN echo "geoip month ${GEOIP_MONTH}" && sh /fetch-dbip.sh /geoip/dbip-country-lite.mmdb && touch /geoip/.keep

FROM node:22-bookworm-slim
RUN useradd -r -u 10001 prgd
WORKDIR /app
COPY --from=build --chown=prgd:prgd /app/apps/www/.next/standalone ./
COPY --from=build --chown=prgd:prgd /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=build --chown=prgd:prgd /app/apps/www/public ./apps/www/public
# Pages render per request, so the markdown and the OpenAPI copy ship with the server.
COPY --from=build --chown=prgd:prgd /app/apps/www/content ./apps/www/content
COPY --from=geoip --chown=prgd:prgd /geoip /app/geoip
# PRGD_DOMAIN and PRGD_DOMAIN_SA (set in compose) name the two storefronts.
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 GEOIP_DB_PATH=/app/geoip/dbip-country-lite.mmdb
USER prgd
EXPOSE 3001
CMD ["node", "apps/www/server.js"]
