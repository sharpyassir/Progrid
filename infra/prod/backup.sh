#!/bin/sh
# Runs inside the backup container. Every night at 02:15 it dumps every database on the server
# (the app, Temporal and PowerDNS live on the same Postgres), keeps BACKUP_KEEP_DAYS days locally,
# copies to S3 compatible storage when BACKUP_S3_URL is set, and writes a status file that the
# health check reads. Point of time recovery comes from WAL archiving, see docker-compose.yml.
# Each result is also reported to the API (POST /internal/platform/backup), which the weekly
# backup check of the DevOps console reads (docs/platform-maintenance.md).
#
#   /backup.sh          run forever, one backup a night
#   /backup.sh once     one backup now, then exit (docker compose run --rm backup once)
#   /backup.sh check    test the off server storage settings, then exit
#
# Off server copies use rclone with an "offsite" remote built from BACKUP_S3_ENDPOINT, the key and
# the secret (see docker-compose.yml); BACKUP_S3_URL is s3://bucket/path.
set -eu
mkdir -p /backups /backups/wal
status=/backups/last-status

report() { # result offsite file
  [ -n "${PRGD_PLATFORM_HEARTBEAT_SECRET:-}" ] || return 0
  size=$( [ -f "$3" ] && wc -c < "$3" || echo 0 )
  wget -q -T 20 -O /dev/null --header "Content-Type: application/json" --header "X-Prgd-Platform-Secret: $PRGD_PLATFORM_HEARTBEAT_SECRET" \
    --post-data "{\"result\":\"$1\",\"offsite\":$2,\"sizeBytes\":$size,\"file\":\"$(basename "$3")\"}" "${PRGD_API_URL:-http://api:4000}/internal/platform/backup" \
    || echo "could not report the backup result to the API"
}

# s3://bucket/path -> offsite:bucket/path
remote=""
if [ -n "${BACKUP_S3_URL:-}" ]; then
  remote="offsite:${BACKUP_S3_URL#s3://}"
  remote="${remote%/}"
  if ! command -v rclone >/dev/null; then
    echo "installing rclone"
    apk add --no-cache rclone >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq rclone >/dev/null; } || echo "could not install rclone"
  fi
fi

offsite_check() {
  [ -n "$remote" ] || { echo "BACKUP_S3_URL is not set"; return 1; }
  command -v rclone >/dev/null || { echo "rclone is missing"; return 1; }
  probe=/backups/.offsite-check
  date -u > "$probe"
  rclone copyto "$probe" "$remote/.offsite-check" && rclone cat "$remote/.offsite-check" >/dev/null && echo "off server storage OK: $remote" || { echo "off server storage FAILED: $remote"; return 1; }
}

backup() {
  stamp=$(date -u +%Y%m%d-%H%M)
  f=/backups/all-$stamp.sql.gz
  if ! pg_dumpall -h postgres -U prgd --clean --if-exists | gzip -6 > "$f.tmp"; then
    rm -f "$f.tmp"; echo "backup FAILED"; echo "failed $stamp" > "$status"; report failed false "$f"; return 1
  fi
  mv "$f.tmp" "$f"
  echo "backup written: $f ($(du -h "$f" | cut -f1))"
  find /backups -name 'all-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  find /backups/wal -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  if [ -z "$remote" ]; then
    echo "ok $stamp" > "$status"; report ok false "$f"; return 0
  fi
  if ! command -v rclone >/dev/null; then
    echo "BACKUP_S3_URL is set but rclone is missing"; echo "s3-missing $stamp" > "$status"; report failed false "$f"; return 1
  fi
  if rclone copy "$f" "$remote/" && rclone sync /backups/wal "$remote/wal/"; then
    # Keep the same number of days off the server.
    rclone delete --min-age "${BACKUP_KEEP_DAYS:-14}d" --include 'all-*.sql.gz' "$remote/" || true
    echo "copied off the server: $remote/$(basename "$f")"
    echo "ok $stamp" > "$status"; report ok true "$f"
  else
    echo "s3 upload FAILED"; echo "s3-failed $stamp" > "$status"; report failed false "$f"; return 1
  fi
}

case "${1:-}" in
  once) backup; exit $? ;;
  check) offsite_check; exit $? ;;
esac

[ -n "$remote" ] && { offsite_check || true; }
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "tomorrow 02:15" +%s 2>/dev/null || echo $((now + 86400)))
  sleep $((next - now))
  backup || true
done
