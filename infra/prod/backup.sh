#!/bin/sh
# Runs inside the backup container. Every night at 02:15 it dumps every database on the server
# (the app, Temporal and PowerDNS live on the same Postgres), keeps BACKUP_KEEP_DAYS days locally,
# copies to S3 compatible storage when BACKUP_S3_URL is set, and writes a status file that the
# health check reads. Point of time recovery comes from WAL archiving, see docker-compose.yml.
#
# With BACKUP_AGE_RECIPIENT (an age public key, age1..., several separated by spaces) every dump is
# encrypted before it touches the disk (all-<stamp>.sql.gz.age, no plain copy) and the WAL goes
# off the server as encrypted .age copies. The private key never lives on this server; restore:
# docs/hosting.md, "Backups and restore".
set -eu
mkdir -p /backups /backups/wal
status=/backups/last-status
recipients="${BACKUP_AGE_RECIPIENT:-}"

# The image (timescale/timescaledb, Alpine) has neither tool; install what the settings need.
if [ -n "$recipients" ] && ! command -v age >/dev/null; then
  echo "installing age"
  apk add --no-cache age >/dev/null 2>&1 || echo "could not install age"
fi
if [ -n "${BACKUP_S3_URL:-}" ] && ! command -v rclone >/dev/null; then
  echo "installing rclone"
  apk add --no-cache rclone >/dev/null 2>&1 || echo "could not install rclone"
fi

# stdin to stdout, encrypted to every recipient.
encrypt() {
  set --
  for r in $recipients; do set -- "$@" -r "$r"; done
  age "$@"
}

# Dump, compress and (with recipients) encrypt into $1. A failing pg_dumpall fails it too, which
# a plain pipeline would hide behind gzip's exit status (no pipefail in every sh).
dump_to() {
  rm -f "$1.err"
  { pg_dumpall -h postgres -U prgd --clean --if-exists || : > "$1.err"; } | gzip -6 \
    | if [ -n "$recipients" ]; then encrypt; else cat; fi > "$1" || return 1
  if [ -e "$1.err" ]; then rm -f "$1.err"; return 1; fi
}

# Encrypted copies of the archived WAL segments in /backups/wal-age, which is what goes off the
# server. Each segment is encrypted once; a copy goes when its segment is pruned from /backups/wal.
encrypt_wal() {
  mkdir -p /backups/wal-age
  for w in /backups/wal/*; do
    [ -f "$w" ] || continue
    e="/backups/wal-age/$(basename "$w").age"
    [ -f "$e" ] && continue
    if encrypt < "$w" > "$e.tmp"; then mv "$e.tmp" "$e"; else rm -f "$e.tmp"; return 1; fi
  done
  for e in /backups/wal-age/*.age; do
    [ -f "$e" ] || continue
    [ -f "/backups/wal/$(basename "$e" .age)" ] || rm -f "$e"
  done
}

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "tomorrow 02:15" +%s 2>/dev/null || echo $((now + 86400)))
  sleep $((next - now))
  stamp=$(date -u +%Y%m%d-%H%M)
  if [ -n "$recipients" ]; then
    if ! command -v age >/dev/null; then
      # Never fall back to a plain dump once encryption is asked for.
      echo "BACKUP_AGE_RECIPIENT is set but age is missing in the image"; echo "age-missing $stamp" > "$status"; continue
    fi
    f=/backups/all-$stamp.sql.gz.age
  else
    f=/backups/all-$stamp.sql.gz
  fi
  if dump_to "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "backup written: $f ($(du -h "$f" | cut -f1))"
    find /backups -maxdepth 1 \( -name 'all-*.sql.gz' -o -name 'all-*.sql.gz.age' \) -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    find /backups/wal -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    if [ -n "${BACKUP_S3_URL:-}" ]; then
      if command -v rclone >/dev/null; then
        walsrc=/backups/wal
        if [ -n "$recipients" ]; then
          walsrc=/backups/wal-age
          encrypt_wal || { echo "wal encryption FAILED"; echo "s3-failed $stamp" > "$status"; continue; }
        fi
        rclone copy "$f" "$BACKUP_S3_URL/" && rclone sync "$walsrc" "$BACKUP_S3_URL/wal/" || { echo "s3 upload FAILED"; echo "s3-failed $stamp" > "$status"; continue; }
      else
        echo "BACKUP_S3_URL is set but rclone is missing in the image"; echo "s3-missing $stamp" > "$status"; continue
      fi
    fi
    echo "ok $stamp" > "$status"
  else
    rm -f "$f.tmp"; echo "backup FAILED"; echo "failed $stamp" > "$status"
  fi
done
