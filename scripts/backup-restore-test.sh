#!/usr/bin/env bash
# Prueba periódica de restauración (semanal: infra/ops/loopchat-restore-test.timer).
# Toma el backup más reciente, lo restaura en una base TEMPORAL, verifica conteos y que las
# credenciales cifradas se puedan descifrar (npm run verify:restore) y borra la base temporal.
# Corre en un host que tenga la clave privada de backups (no el servidor de producción).
#
# Variables: BACKUP_DIR (o RESTORE_TEST_PACKAGE), BACKUP_PRIVATE_KEY, RESTORE_TEST_ADMIN_URL
# (conexión con permiso para crear/borrar bases, p. ej. postgres://user:pass@host:5432/postgres).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${RESTORE_TEST_ADMIN_URL:?RESTORE_TEST_ADMIN_URL requerido}"
shopt -s nullglob
CANDIDATES=("${BACKUP_DIR:-./backups}"/loopchat-*.tar.enc "${BACKUP_DIR:-./backups}"/loopchat-*.tar)
PKG="${RESTORE_TEST_PACKAGE:-$( [ ${#CANDIDATES[@]} -gt 0 ] && ls -1t "${CANDIDATES[@]}" | head -1 || true)}"
DB="loopchat_restore_test_$(date -u +%s)"
TARGET="${RESTORE_TEST_ADMIN_URL%/*}/$DB"
heartbeat() { [ "${BACKUP_SKIP_HEARTBEAT:-false}" = "true" ] || (cd "$HERE/.." && npm run --silent ops:heartbeat -- restore_test "$1" "$2") || true; }
cleanup() { psql "$RESTORE_TEST_ADMIN_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; rm -rf "${STORE:-}"; }
trap 'cleanup; heartbeat fail "prueba de restore falló (línea $LINENO)"; exit 1' ERR
[ -n "$PKG" ] && [ -f "$PKG" ] || { heartbeat fail "no hay backups para probar"; echo "No hay backups" >&2; exit 1; }

psql "$RESTORE_TEST_ADMIN_URL" -qc "create database $DB" >/dev/null
STORE="$(mktemp -d)"
TARGET_DATABASE_URL="$TARGET" RESTORE_STORAGE_DIR="$STORE" DATABASE_URL="" bash "$HERE/restore.sh" "$PKG"
OUT="$(cd "$HERE/.." && RESTORE_DATABASE_URL="$TARGET" npm run --silent verify:restore)"
echo "$OUT"
trap - ERR
cleanup
heartbeat ok "$(basename "$PKG"): $(echo "$OUT" | tr '\n' ' ' | cut -c1-300)"
echo "Prueba de restore OK: $(basename "$PKG")"
