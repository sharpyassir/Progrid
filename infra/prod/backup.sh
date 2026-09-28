#!/bin/sh
# Runs inside the backup container. Every night at 02:15 it dumps every database on the server
# (the app, Temporal and PowerDNS live on the same Postgres), keeps BACKUP_KEEP_DAYS days locally,
# copies to S3 compatible storage when BACKUP_S3_URL is set, and writes a status file that the
# health check reads. Point of time recovery comes from WAL archiving, see docker-compose.yml.
set -eu
mkdir -p /backups /backups/wal
status=/backups/last-status
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
        rclone copy "$f" "$BACKUP_S3_URL/" && rclone sync /backups/wal "$BACKUP_S3_URL/wal/" || { echo "s3 upload FAILED"; echo "s3-failed $stamp" > "$status"; continue; }
      else
        echo "BACKUP_S3_URL is set but rclone is missing in the image"; echo "s3-missing $stamp" > "$status"; continue
      fi
    fi
    echo "ok $stamp" > "$status"
  else
    rm -f "$f.tmp"; echo "backup FAILED"; echo "failed $stamp" > "$status"
  fi
done
