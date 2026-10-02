#!/bin/sh
# Runs inside the backup container. Every night at 02:15 it dumps every database on the server
# (the app, Temporal and PowerDNS live on the same Postgres), keeps BACKUP_KEEP_DAYS days locally,
# copies to S3 compatible storage when BACKUP_S3_URL is set, and writes a status file that the
# health check reads. Point of time recovery comes from WAL archiving, see docker-compose.yml.
# Each result is also reported to the API (POST /internal/platform/backup), which the weekly
# backup check of the DevOps console reads (docs/platform-maintenance.md).
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
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "tomorrow 02:15" +%s 2>/dev/null || echo $((now + 86400)))
  sleep $((next - now))
  stamp=$(date -u +%Y%m%d-%H%M)
  f=/backups/all-$stamp.sql.gz
  if pg_dumpall -h postgres -U prgd --clean --if-exists | gzip -6 > "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "backup written: $f ($(du -h "$f" | cut -f1))"
    find /backups -name 'all-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    find /backups/wal -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    if [ -n "${BACKUP_S3_URL:-}" ]; then
      if command -v rclone >/dev/null; then
        rclone copy "$f" "$BACKUP_S3_URL/" && rclone sync /backups/wal "$BACKUP_S3_URL/wal/" || { echo "s3 upload FAILED"; echo "s3-failed $stamp" > "$status"; report failed false "$f"; continue; }
      else
        echo "BACKUP_S3_URL is set but rclone is missing in the image"; echo "s3-missing $stamp" > "$status"; report failed false "$f"; continue
      fi
      report ok true "$f"
    else
      report ok false "$f"
    fi
    echo "ok $stamp" > "$status"
  else
    rm -f "$f.tmp"; echo "backup FAILED"; echo "failed $stamp" > "$status"; report failed false "$f"
  fi
done
