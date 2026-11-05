#!/usr/bin/env bash
# Restaura un backup de Loopchat en bases indicadas (usar SIEMPRE primero una base temporal).
#
# Uso:
#   BACKUP_PRIVATE_KEY=/ruta/segura/backup-private.pem \
#   TARGET_DATABASE_URL=postgres://.../loopchat_restore \
#   [TARGET_CHATWOOT_DATABASE_URL=postgres://.../chatwoot_restore] [RESTORE_STORAGE_DIR=./storage-restore] \
#   scripts/restore.sh backups/loopchat-YYYYMMDDTHHMMSSZ.tar.enc
#
# Verifica el SHA-256 del paquete (si está el .sha256 al lado) y el MANIFEST interno antes de restaurar.
# Se niega a restaurar sobre DATABASE_URL (la base en uso) para evitar pisar producción por error.
set -euo pipefail
umask 077
PKG="${1:?paquete de backup requerido (.tar.enc o .tar)}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL requerido}"
if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo "Me niego a restaurar sobre DATABASE_URL (base en uso). Restaurá en una base temporal." >&2
  exit 2
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/loopchat-restore.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
DIR="$(cd "$(dirname "$PKG")" && pwd)"
BASE="$(basename "$PKG")"
NAME="${BASE%.tar.enc}"; NAME="${NAME%.tar}"

if [ -f "$DIR/$NAME.sha256" ]; then (cd "$DIR" && sha256sum -c "$NAME.sha256" >/dev/null) || { echo "El checksum del paquete no coincide" >&2; exit 1; }; fi
if [[ "$BASE" == *.tar.enc ]]; then
  : "${BACKUP_PRIVATE_KEY:?BACKUP_PRIVATE_KEY requerido para descifrar}"
  openssl pkeyutl -decrypt -inkey "$BACKUP_PRIVATE_KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$DIR/$NAME.key.enc" -out "$WORK/key.bin"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$PKG" -out "$WORK/$NAME.tar" -pass "file:$WORK/key.bin"
else
  cp "$PKG" "$WORK/$NAME.tar"
fi
tar -xf "$WORK/$NAME.tar" -C "$WORK"
(cd "$WORK/$NAME" && sha256sum -c MANIFEST.sha256 >/dev/null) || { echo "El contenido no coincide con el MANIFEST" >&2; exit 1; }

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL" "$WORK/$NAME/loopchat.dump"
if [ -f "$WORK/$NAME/chatwoot.dump" ] && [ -n "${TARGET_CHATWOOT_DATABASE_URL:-}" ]; then
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_CHATWOOT_DATABASE_URL" "$WORK/$NAME/chatwoot.dump"
fi
if [ -f "$WORK/$NAME/loopchat-storage.tar.gz" ]; then
  mkdir -p "${RESTORE_STORAGE_DIR:-./storage-restore}"
  tar -xzf "$WORK/$NAME/loopchat-storage.tar.gz" -C "${RESTORE_STORAGE_DIR:-./storage-restore}"
fi
echo "Restore completado en $TARGET_DATABASE_URL (verificar con: RESTORE_DATABASE_URL=… npm run verify:restore)"
