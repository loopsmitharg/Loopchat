#!/usr/bin/env bash
# Restaura un backup de Loopchat en bases indicadas (usar SIEMPRE primero una base temporal).
#
# Uso:
#   BACKUP_PRIVATE_KEY=/ruta/segura/backup-private.pem \
#   TARGET_DATABASE_URL=postgres://.../loopchat_restore \
#   [TARGET_CHATWOOT_DATABASE_URL=postgres://.../chatwoot_restore] [RESTORE_STORAGE_DIR=./storage-restore] \
#   [RESTORE_CHATWOOT_STORAGE_DIR=./chatwoot-storage-restore] [RESTORE_MEDIA_DIR=<descarga de RCLONE_REMOTE/media>] \
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
# Adjuntos de Chatwoot: dentro del paquete (backup sin R2) o descargados de <RCLONE_REMOTE>/media (RESTORE_MEDIA_DIR)
if [ -n "${RESTORE_CHATWOOT_STORAGE_DIR:-}" ]; then
  mkdir -p "$RESTORE_CHATWOOT_STORAGE_DIR"
  if [ -f "$WORK/$NAME/chatwoot-storage.tar.gz" ]; then tar -xzf "$WORK/$NAME/chatwoot-storage.tar.gz" -C "$RESTORE_CHATWOOT_STORAGE_DIR"; fi
  if [ -n "${RESTORE_MEDIA_DIR:-}" ]; then
    : "${BACKUP_PRIVATE_KEY:?BACKUP_PRIVATE_KEY requerido para descifrar adjuntos}"
    # formato de scripts/backup.sh (encrypt_file): [clave+IV envueltos con RSA][AES-256-CBC]
    KB=$(( $(openssl pkey -in "$BACKUP_PRIVATE_KEY" -noout -text | sed -n 's/.*(\([0-9]*\) bit.*/\1/p' | head -1) / 8 ))
    n=0
    while IFS= read -r -d '' f; do
      rel="${f#"$RESTORE_MEDIA_DIR"/}"; out="$RESTORE_CHATWOOT_STORAGE_DIR/${rel%.enc}"
      mkdir -p "$(dirname "$out")"
      head -c "$KB" "$f" > "$WORK/kiv.enc"
      openssl pkeyutl -decrypt -inkey "$BACKUP_PRIVATE_KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$WORK/kiv.enc" -out "$WORK/kiv"
      hex="$(od -An -tx1 -v "$WORK/kiv" | tr -d ' \n')"
      tail -c +"$((KB + 1))" "$f" | openssl enc -d -aes-256-cbc -K "${hex:0:64}" -iv "${hex:64:32}" > "$out"
      n=$((n + 1))
    done < <(find "$RESTORE_MEDIA_DIR" -type f -name '*.enc' -print0)
    echo "Adjuntos de Chatwoot descifrados: $n en $RESTORE_CHATWOOT_STORAGE_DIR"
  fi
fi
echo "Restore completado en $(echo "$TARGET_DATABASE_URL" | sed "s|//[^@]*@|//***@|") (verificar con: RESTORE_DATABASE_URL=… npm run verify:restore)"
