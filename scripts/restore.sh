#!/usr/bin/env bash
# Restaura un backup de Loopchat en la base indicada (usar SIEMPRE primero una base temporal).
# Uso: TARGET_DATABASE_URL=postgres://.../loopchat_restore scripts/restore.sh backups/loopchat-db-XXXX.dump [storage.tar.gz] [STORAGE_DIR]
set -euo pipefail
DUMP="${1:?archivo .dump requerido}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL requerido}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" "$DUMP"
if [ -n "${2:-}" ]; then
  mkdir -p "${3:-./storage-restore}"
  tar -xzf "$2" -C "${3:-./storage-restore}"
fi
echo "Restore completado en $TARGET_DATABASE_URL"
