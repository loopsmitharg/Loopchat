#!/usr/bin/env bash
# Instala /etc/loopchat/rclone.conf (remoto "r2" de Cloudflare R2) desde un archivo de credenciales subido a ~deploy,
# lo borra con shred y verifica el acceso al bucket con UNA operación de listado, tal como lo hará el backup
# (contenedor con uid 1001, config montada de solo lectura). No activa backups ni escribe en el bucket.
#
# Uso, como deploy en el VPS, con ~/r2-rclone.env subido (3 líneas, sin comillas):
#   R2_ACCESS_KEY_ID=…
#   R2_SECRET_ACCESS_KEY=…
#   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   sudo bash ~/install-rclone.sh loopchat-backups-prod
# Nunca imprime las credenciales.
set -euo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo "Correr con sudo"; exit 1; }
BUCKET="${1:?nombre del bucket}"
SRC=/home/deploy/r2-rclone.env
DEST=/etc/loopchat/rclone.conf
RCLONE_IMAGE=rclone/rclone:1.68.2
[ -s "$SRC" ] || { echo "Falta $SRC"; exit 1; }
trap 'shred -u "$SRC" 2>/dev/null || true' EXIT # la copia subida se destruye siempre, salga bien o mal

val() { sed -n "s/^$1=//p" "$SRC" | tr -d '\r' | head -1; }
KEY_ID="$(val R2_ACCESS_KEY_ID)"; SECRET="$(val R2_SECRET_ACCESS_KEY)"; ENDPOINT="$(val R2_ENDPOINT)"
[[ "$KEY_ID" =~ ^[A-Za-z0-9]{20,64}$ ]] || { echo "R2_ACCESS_KEY_ID ausente o con formato inválido"; exit 1; }
[[ "$SECRET" =~ ^[A-Za-z0-9]{32,128}$ ]] || { echo "R2_SECRET_ACCESS_KEY ausente o con formato inválido"; exit 1; }
[[ "$ENDPOINT" =~ ^https://[0-9a-f]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com/?$ ]] || { echo "R2_ENDPOINT inválido (esperado https://<ACCOUNT_ID>.r2.cloudflarestorage.com)"; exit 1; }

# printf es builtin: los valores no pasan por argumentos de procesos (ps) ni por el historial
TMP="$(mktemp /etc/loopchat/.rclone.XXXXXX)"
printf '[r2]\ntype = s3\nprovider = Cloudflare\naccess_key_id = %s\nsecret_access_key = %s\nendpoint = %s\nacl = private\nno_check_bucket = true\n' \
  "$KEY_ID" "$SECRET" "${ENDPOINT%/}" > "$TMP"
unset KEY_ID SECRET
# dueño uid 1001 = usuario del contenedor de la app (en este host, también deploy); solo lectura para él
chown 1001:root "$TMP" && chmod 400 "$TMP" && mv -f "$TMP" "$DEST"

check() { docker run --rm -u 1001:1001 -v "$DEST:/run/rclone.conf:ro" "$RCLONE_IMAGE" --config /run/rclone.conf "$@"; }
docker pull -q "$RCLONE_IMAGE" >/dev/null
# 1 operación Clase A (ListObjects, máx. 1000 claves) sobre la raíz del bucket
if OUT="$(check lsf --max-depth 1 "r2:$BUCKET" 2>&1)"; then
  echo "OK: acceso de lectura al bucket $BUCKET ($(printf '%s' "$OUT" | grep -c . || true) entradas en la raíz)"
else
  echo "FALLÓ el listado del bucket $BUCKET:"; printf '%s\n' "$OUT" | grep -iE 'error|denied|forbidden|signature|not ?found' | head -3 | sed -E 's/[A-Za-z0-9]{32,}/***/g'
  exit 1
fi
# alcance del token: listar buckets de la cuenta debe estar prohibido (un 403 AccessDenied no se cobra)
if check lsd r2: >/dev/null 2>&1; then echo "AVISO: el token puede listar todos los buckets (no está limitado a $BUCKET)"; else echo "OK: el token no puede listar otros buckets"; fi
echo "Config: $(stat -c '%U(%u):%G %a' "$DEST") $DEST — copia subida destruida. Backups automáticos: sin activar."
