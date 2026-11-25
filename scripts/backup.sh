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
#   BACKUP_RETENTION_DAYS (14)         RCLONE_REMOTE (p. ej. "r2:loopchat-backups/prod"; vacío = sin copia externa)
#   BACKUP_REMOTE_RETENTION_DAYS (7)   BACKUP_SKIP_HEARTBEAT=true para no registrar (pruebas)
#   Con copia externa (R2): R2_ACCOUNT_ID, R2_ANALYTICS_TOKEN y topes R2_MAX_BYTES/R2_WARN_BYTES (ver scripts/r2-budget.ts).
#   Con R2, los adjuntos de CHATWOOT_STORAGE_DIR se suben cifrados de a uno y una sola vez a <RCLONE_REMOTE>/media/.
#   Antes de subir mide la cuenta entera; si no entra bajo el tope, no sube y alerta (nunca borra copias válidas).
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL requerido}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/loopchat-backup.XXXXXX")"
NAME="loopchat-$STAMP"
HERE="$(cd "$(dirname "$0")" && pwd)"

heartbeat_as() {
  [ "${BACKUP_SKIP_HEARTBEAT:-false}" = "true" ] && return 0
  (cd "$HERE/.." && npm run --silent ops:heartbeat -- "$1" "$2" "$3") || echo "aviso: no se pudo registrar el heartbeat" >&2
}
heartbeat() { heartbeat_as backup "$1" "$2"; }
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

# Cifra un archivo suelto (adjuntos): [clave AES-256 + IV envueltos con RSA-OAEP][AES-256-CBC]. Mismo modelo que el
# paquete: el servidor cifra con la pública y no puede descifrar. Tamaño: bytes RSA + (n/16 + 1) × 16.
encrypt_file() {
  local kiv hex
  mkdir -p "$(dirname "$2")"
  kiv="$WORK/kiv.bin"
  openssl rand -out "$kiv" 48
  hex="$(od -An -tx1 -v "$kiv" | tr -d ' \n')"
  { openssl pkeyutl -encrypt -pubin -inkey "$BACKUP_PUBLIC_KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$kiv"
    openssl enc -aes-256-cbc -K "${hex:0:64}" -iv "${hex:64:32}" -in "$1"; } > "$2"
}

echo "Backup $NAME"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | dump_and_check "$WORK/$NAME/loopchat.dump"
if [ -n "${CHATWOOT_PG_DUMP_CMD:-}" ]; then
  bash -c "$CHATWOOT_PG_DUMP_CMD" | dump_and_check "$WORK/$NAME/chatwoot.dump"
elif [ -n "${CHATWOOT_DATABASE_URL:-}" ]; then
  pg_dump --format=custom --no-owner --no-privileges "$CHATWOOT_DATABASE_URL" | dump_and_check "$WORK/$NAME/chatwoot.dump"
fi
if [ -d "${STORAGE_DIR:-./storage}" ]; then tar -czf "$WORK/$NAME/loopchat-storage.tar.gz" -C "${STORAGE_DIR:-./storage}" .; fi
MEDIA=""
if [ -n "${CHATWOOT_STORAGE_DIR:-}" ] && [ -d "$CHATWOOT_STORAGE_DIR" ]; then
  if [ -n "${RCLONE_REMOTE:-}" ]; then
    # adjuntos de Chatwoot: incrementales a R2 (cada archivo una sola vez), no dentro del paquete diario.
    # Se listan DESPUÉS del dump: todo adjunto que la base referencia ya está en disco.
    MEDIA="$WORK/media.tsv"
    (cd "$CHATWOOT_STORAGE_DIR" && find . -type f -printf '%s\t%P\n') > "$MEDIA"
    echo "  adjuntos de Chatwoot: $(wc -l < "$MEDIA") archivos (copia incremental)"
  else
    tar -czf "$WORK/$NAME/chatwoot-storage.tar.gz" -C "$CHATWOOT_STORAGE_DIR" .
  fi
fi
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
  [ -n "${BACKUP_PUBLIC_KEY:-}" ] || fail "la copia externa exige backup cifrado (BACKUP_PUBLIC_KEY)"
  # RCLONE_REMOTE = remoto:bucket[/carpeta]; el bucket debe ser exclusivo de backups
  RNAME="${RCLONE_REMOTE%%:*}"; RPATH="${RCLONE_REMOTE#*:}"; BUCKET="${RPATH%%/*}"
  PREFIX=""; [ "$RPATH" != "$BUCKET" ] && PREFIX="${RPATH#*/}"
  # Presupuesto R2 (franquicia de 10 GB compartida por la cuenta): primero medir, después decidir
  # --fast-list: un solo listado recursivo (1 op Clase A cada 1000 objetos), no uno por carpeta
  rclone lsjson -R --fast-list --files-only "$RNAME:$BUCKET" > "$WORK/remote.json" || fail "R2: no se pudo listar el bucket (no se subió; copia local conservada)"
  INCOMING="$(cat "${OUT[@]}" | wc -c)"
  MEDIA_ARGS=()
  if [ -n "$MEDIA" ]; then
    KEYBITS="$(openssl pkey -pubin -in "$BACKUP_PUBLIC_KEY" -noout -text | sed -n 's/.*(\([0-9]*\) bit).*/\1/p' | head -1)"
    MEDIA_ARGS=("$MEDIA" "$((KEYBITS / 8))" "$BACKUP_DIR/r2-media-orphans.json" "$WORK/media-upload.txt")
  fi
  (cd "$HERE/.." && npm run --silent ops:r2-budget -- "$WORK/remote.json" "$INCOMING" "$BUCKET" "$PREFIX" "$WORK/expired.txt" "${MEDIA_ARGS[@]}") > "$WORK/budget.txt"     || fail "R2: no se pudo verificar el presupuesto (no se subió; copia local conservada)"
  budget() { sed -n "s/^$1=//p" "$WORK/budget.txt"; }
  # solo vencidas o incompletas; nunca la última copia completa (lo garantiza r2-budget)
  if [ -s "$WORK/expired.txt" ]; then
    rclone delete "$RNAME:$BUCKET" --files-from-raw "$WORK/expired.txt" || echo "aviso: no se pudo aplicar la retención externa" >&2
  fi
  if [ -n "$(budget WARN)" ]; then heartbeat_as r2_budget fail "$(budget WARN)"; else heartbeat_as r2_budget ok "$(budget SUMMARY)"; fi
  if [ "$(budget UPLOAD)" != "yes" ]; then
    heartbeat_as r2_budget fail "$(budget REASON)"
    fail "R2: $(budget REASON) (no se subió; copia local conservada)"
  fi
  # adjuntos primero: un paquete de base solo llega a R2 cuando sus adjuntos ya están arriba
  if [ -s "$WORK/media-upload.txt" ]; then
    echo "  cifrando $(wc -l < "$WORK/media-upload.txt") adjuntos nuevos"
    while IFS= read -r rel; do encrypt_file "$CHATWOOT_STORAGE_DIR/$rel" "$WORK/media/$rel.enc"; done < "$WORK/media-upload.txt"
    # --no-traverse: no lista el destino; rclone verifica el MD5 de cada objeto al subirlo
    rclone copy "$WORK/media" "$RCLONE_REMOTE/media" --no-traverse || fail "R2: falló la subida de adjuntos (se reintenta en el próximo backup)"
  fi
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --max-depth 1 --include "$NAME.*"
  # compara tamaño y hash (o contenido con --download si el destino no expone hashes)
  if ! rclone check "$BACKUP_DIR" "$RCLONE_REMOTE" --max-depth 1 --one-way --include "$NAME.*" ${RCLONE_CHECK_DOWNLOAD:+--download} >/dev/null 2>&1; then
    rclone delete "$RCLONE_REMOTE" --max-depth 1 --include "$NAME.*" || true # una copia que no coincide no cuenta como válida
    fail "la copia externa no coincide con el backup local"
  fi
  REMOTE="copia externa verificada en $RCLONE_REMOTE; $(budget SUMMARY)"
fi
find "$BACKUP_DIR" -maxdepth 1 -name 'loopchat-*' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete

trap - ERR
SIZE="$(du -ch "${OUT[@]}" | tail -1 | cut -f1)"
heartbeat ok "$NAME ($SIZE, $REMOTE)"
cleanup
echo "Backup listo: $NAME ($SIZE, $REMOTE)"
