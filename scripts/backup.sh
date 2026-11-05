#!/usr/bin/env bash
# Backup operativo de Loopchat (correr a diario: infra/ops/loopchat-backup.timer).
#
# Qué respalda: base de Loopchat, base de Chatwoot (si se configura), archivos de Loopchat (STORAGE_DIR)
# y de Chatwoot (CHATWOOT_STORAGE_DIR, si se configura). No incluye secretos de entorno: guardarlos en
# un gestor de secretos (ver docs/operations.md).
#
# Cómo garantiza que el backup sirve (no alcanza con que el script termine en 0):
#   1. cada dump se valida con `pg_restore --list` (tabla de contenidos legible y no vacía);
#   2. el paquete se cifra con una clave aleatoria (AES-256) envuelta con la CLAVE PÚBLICA RSA
#      BACKUP_PUBLIC_KEY: el servidor puede cifrar pero NO descifrar (la privada se guarda fuera);
#   3. se registra el SHA-256 del paquete cifrado y, si hay copia externa, se verifica con `rclone check`;
#   4. el resultado (ok/fail) queda en la base (`npm run ops:heartbeat`) y el monitor alerta si falta o falla;
#   5. la restauración se prueba aparte (scripts/backup-restore-test.sh, semanal).
#
# Variables:
#   DATABASE_URL (obligatoria)        CHATWOOT_DATABASE_URL (opcional; o CHATWOOT_PG_DUMP_CMD)
#   STORAGE_DIR (./storage)            CHATWOOT_STORAGE_DIR (opcional)
#   BACKUP_DIR (./backups)             BACKUP_PUBLIC_KEY (PEM RSA; obligatoria salvo BACKUP_ALLOW_UNENCRYPTED=true en desarrollo)
#   BACKUP_RETENTION_DAYS (14)         RCLONE_REMOTE (p. ej. "b2:loopchat-backups/prod"; vacío = sin copia externa)
#   BACKUP_REMOTE_RETENTION_DAYS (30)  BACKUP_SKIP_HEARTBEAT=true para no registrar (pruebas)
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL requerido}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/loopchat-backup.XXXXXX")"
NAME="loopchat-$STAMP"
HERE="$(cd "$(dirname "$0")" && pwd)"

heartbeat() {
  [ "${BACKUP_SKIP_HEARTBEAT:-false}" = "true" ] && return 0
  (cd "$HERE/.." && npm run --silent ops:heartbeat -- backup "$1" "$2") || echo "aviso: no se pudo registrar el heartbeat" >&2
}
cleanup() { rm -rf "$WORK"; }
fail() {
  trap - ERR
  local reason="$1"
  # un paso dentro de un pipe (subshell) deja el motivo concreto en este archivo
  [ -s "$WORK/reason" ] && reason="$(cat "$WORK/reason")"
  echo "BACKUP FALLÓ: $reason" >&2
  heartbeat fail "$reason"
  cleanup
  exit 1
}
trap 'fail "error en la línea $LINENO"' ERR

if [ -z "${BACKUP_PUBLIC_KEY:-}" ] && [ "${BACKUP_ALLOW_UNENCRYPTED:-false}" != "true" ]; then
  fail "BACKUP_PUBLIC_KEY no configurada (los backups deben salir cifrados)"
fi
mkdir -p "$BACKUP_DIR" "$WORK/$NAME"

dump_and_check() { # $1 = archivo destino; el dump llega por stdin (corre en un subshell del pipe)
  cat > "$1"
  if [ ! -s "$1" ]; then echo "dump vacío: $(basename "$1")" > "$WORK/reason"; return 1; fi
  local entries
  entries="$(pg_restore --list "$1" | grep -c ' TABLE ' || true)"
  if [ "$entries" -le 0 ]; then echo "dump sin tablas: $(basename "$1")" > "$WORK/reason"; return 1; fi
  echo "  $(basename "$1"): $entries tablas"
}

echo "Backup $NAME"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | dump_and_check "$WORK/$NAME/loopchat.dump"
if [ -n "${CHATWOOT_PG_DUMP_CMD:-}" ]; then
  bash -c "$CHATWOOT_PG_DUMP_CMD" | dump_and_check "$WORK/$NAME/chatwoot.dump"
elif [ -n "${CHATWOOT_DATABASE_URL:-}" ]; then
  pg_dump --format=custom --no-owner --no-privileges "$CHATWOOT_DATABASE_URL" | dump_and_check "$WORK/$NAME/chatwoot.dump"
fi
if [ -d "${STORAGE_DIR:-./storage}" ]; then tar -czf "$WORK/$NAME/loopchat-storage.tar.gz" -C "${STORAGE_DIR:-./storage}" .; fi
if [ -n "${CHATWOOT_STORAGE_DIR:-}" ] && [ -d "$CHATWOOT_STORAGE_DIR" ]; then tar -czf "$WORK/$NAME/chatwoot-storage.tar.gz" -C "$CHATWOOT_STORAGE_DIR" .; fi
(cd "$WORK/$NAME" && sha256sum ./* > MANIFEST.sha256)
tar -cf "$WORK/$NAME.tar" -C "$WORK" "$NAME"

if [ -n "${BACKUP_PUBLIC_KEY:-}" ]; then
  openssl rand -out "$WORK/key.bin" 32
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$WORK/$NAME.tar" -out "$BACKUP_DIR/$NAME.tar.enc" -pass "file:$WORK/key.bin"
  openssl pkeyutl -encrypt -pubin -inkey "$BACKUP_PUBLIC_KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$WORK/key.bin" -out "$BACKUP_DIR/$NAME.key.enc"
  OUT=("$BACKUP_DIR/$NAME.tar.enc" "$BACKUP_DIR/$NAME.key.enc")
else
  echo "aviso: backup SIN cifrar (BACKUP_ALLOW_UNENCRYPTED=true, solo desarrollo)" >&2
  cp "$WORK/$NAME.tar" "$BACKUP_DIR/$NAME.tar"
  OUT=("$BACKUP_DIR/$NAME.tar")
fi
(cd "$BACKUP_DIR" && sha256sum "${OUT[@]##*/}" > "$NAME.sha256")
OUT+=("$BACKUP_DIR/$NAME.sha256")

REMOTE="sin copia externa"
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "$NAME.*"
  # compara tamaño y hash (o contenido con --download si el destino no expone hashes)
  rclone check "$BACKUP_DIR" "$RCLONE_REMOTE" --one-way --include "$NAME.*" ${RCLONE_CHECK_DOWNLOAD:+--download} >/dev/null 2>&1 || fail "la copia externa no coincide con el backup local"
  rclone delete --min-age "${BACKUP_REMOTE_RETENTION_DAYS:-30}d" --include "loopchat-*" "$RCLONE_REMOTE" || echo "aviso: no se pudo aplicar la retención externa" >&2
  REMOTE="copia externa verificada en $RCLONE_REMOTE"
fi
find "$BACKUP_DIR" -maxdepth 1 -name 'loopchat-*' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete

trap - ERR
SIZE="$(du -ch "${OUT[@]}" | tail -1 | cut -f1)"
heartbeat ok "$NAME ($SIZE, $REMOTE)"
cleanup
echo "Backup listo: $NAME ($SIZE, $REMOTE)"
