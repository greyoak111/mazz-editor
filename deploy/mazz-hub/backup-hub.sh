#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${MAZZ_HUB_DATA:-/var/lib/mazz-hub}"
BACKUP_ROOT="${1:?backup directory is required}"
mkdir -p "$BACKUP_ROOT"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_ROOT/mazz-hub-$stamp.tar.gz"
if [ -d "$DATA_ROOT" ]; then
  tar -C "$DATA_ROOT" -czf "$archive" .
else
  mkdir -p "$DATA_ROOT"
  tar -C "$DATA_ROOT" -czf "$archive" .
fi
sha256sum "$archive" > "$archive.sha256"
printf '%s\n' "$archive"
