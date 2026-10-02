#!/bin/sh
# Downloads DB-IP "IP to Country Lite" (mmdb, CC BY 4.0, https://db-ip.com) to $1.
# DB-IP publishes a new file at the start of every month as dbip-country-lite-YYYY-MM.mmdb.gz and
# needs no license key. Tries this month, then last month. A failed download is not fatal: without
# the file the website does not redirect by country and signup has no country prefill.
# Refresh: rebuild the www and api images (the deploy workflow does on every push), or run this
# script on the host into the mounted path monthly (docs/domains-and-entities.md).
set -u
out="${1:?usage: fetch-dbip.sh <output.mmdb>}"
mkdir -p "$(dirname "$out")"
for month in "$(date -u +%Y-%m)" "$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m)"; do
  url="https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz"
  if curl -fsSL --retry 2 --max-time 120 "$url" -o "$out.gz" && gunzip -f "$out.gz"; then
    echo "geoip: $url -> $out"
    exit 0
  fi
  rm -f "$out.gz"
done
echo "geoip: download failed; continuing without a country database" >&2
exit 0
