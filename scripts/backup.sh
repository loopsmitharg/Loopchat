#!/usr/bin/env bash
# Backup consistente de Loopchat (DB propia + archivos de conocimiento).
# Chatwoot se respalda por separado (ver docs/operations.md).
# Uso: DATABASE_URL=... STORAGE_DIR=./storage scripts/backup.sh [carpeta_destino]
set -euo pipefail
DEST="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
: "${DATABASE_URL:?DATABASE_URL requerido}"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$DEST/loopchat-db-$STAMP.dump"
if [ -d "${STORAGE_DIR:-./storage}" ]; then
  tar -czf "$DEST/loopchat-storage-$STAMP.tar.gz" -C "${STORAGE_DIR:-./storage}" .
fi
echo "Backup listo en $DEST ($STAMP)"
