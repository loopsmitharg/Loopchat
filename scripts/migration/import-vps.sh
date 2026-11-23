#!/usr/bin/env bash
# Importa en el VPS el paquete de scripts/migration/export-local.ps1 (bases de Loopchat y Chatwoot JUNTAS + archivos).
# Uso (desde /opt/loopchat, con .env.production e infra/chatwoot/.env ya completos y los MISMOS secretos que la PC):
#   bash scripts/migration/import-vps.sh /ruta/al/paquete
# Seguro por diseño: se niega a restaurar sobre bases que ya tienen datos. Termina con verificación de integridad.
set -euo pipefail
B="$(cd "${1:?uso: import-vps.sh <carpeta-del-paquete>}" && pwd)"
cd "$(dirname "$0")/../.."
# CW_PROJECT/LC_PROJECT: solo para ensayar la importación en una máquina que ya usa esos nombres (p. ej. la PC)
CWP="${CW_PROJECT:-chatwoot}"
CW="docker compose -p $CWP --project-directory infra/chatwoot -f infra/chatwoot/docker-compose.yml"
LC="docker compose -p ${LC_PROJECT:-loopchat} -f infra/loopchat/docker-compose.yml --env-file .env.production"
say() { printf '\n== %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
meta() { sed -n "s/^$1=//p" "$B/meta.txt"; }
envv() { sed -n "s/^$2=//p" "$1" | head -1; }

say "1) Paquete y configuración"
(cd "$B" && sha256sum -c --quiet SHA256SUMS) || die "el paquete está corrupto o incompleto"
[ -f .env.production ] || die "falta .env.production (infra/loopchat/env.production.example)"
[ -f infra/chatwoot/.env ] || die "falta infra/chatwoot/.env (copiar el de la PC y cambiar FRONTEND_URL)"
[ "$(envv infra/chatwoot/.env CHATWOOT_VERSION)" = "$(meta chatwoot_version)" ] || die "CHATWOOT_VERSION distinta de la exportada ($(meta chatwoot_version))"
APP_URL="$(envv .env.production APP_URL)"
case "$APP_URL" in https://*) ;; *) die "APP_URL debe ser https:// (es '$APP_URL')";; esac
echo "paquete $(meta exported_at), commit $(meta git_commit), Chatwoot $(meta chatwoot_version)"

say "2) Chatwoot: base + archivos"
$CW up -d postgres redis
until $CW exec -T postgres pg_isready -U postgres -d chatwoot >/dev/null 2>&1; do sleep 2; done
[ "$($CW exec -T postgres psql -U postgres -d chatwoot -Atc "select count(*) from pg_tables where schemaname='public'")" = "0" ] \
  || die "la base de Chatwoot del VPS ya tiene tablas: no se sobrescribe (restaurar a mano si es intencional)"
$CW exec -T postgres pg_restore -U postgres -d chatwoot --no-owner --exit-on-error < "$B/chatwoot.dump"
docker volume create "${CWP}_storage_data" >/dev/null
docker run --rm -v "${CWP}_storage_data:/v" -v "$B:/in:ro" alpine:3 tar xzf /in/chatwoot-storage.tgz -C /v
$CW run --rm rails bundle exec rails db:chatwoot_prepare

say "3) Loopchat: base + archivos + migraciones"
$LC build
$LC up -d db
until $LC exec -T db pg_isready -U loopchat -d loopchat >/dev/null 2>&1; do sleep 2; done
[ "$($LC exec -T db psql -U loopchat -d loopchat -Atc "select count(*) from pg_tables where schemaname='public'")" = "0" ] \
  || die "la base de Loopchat del VPS ya tiene tablas: no se sobrescribe"
$LC exec -T db pg_restore -U loopchat -d loopchat --no-owner --exit-on-error < "$B/loopchat.dump"
$LC run --rm --no-deps -T -v "$B:/in:ro" --entrypoint tar app xzf /in/loopchat-storage.tgz -C /data/storage
$LC run --rm -T app npm run db:migrate

say "4) Integridad"
fail=0
$LC exec -T db psql -U loopchat -d loopchat -At -F '=' < scripts/migration/loopchat-counts.sql > /tmp/lc-counts.txt
$CW exec -T postgres psql -U postgres -d chatwoot -At -F '=' < scripts/migration/chatwoot-counts.sql > /tmp/cw-counts.txt
diff <(tr -d '\r' < "$B/loopchat-counts.txt") /tmp/lc-counts.txt && echo "Loopchat: conteos iguales" || { echo "Loopchat: CONTEOS DISTINTOS"; fail=1; }
diff <(tr -d '\r' < "$B/chatwoot-counts.txt") /tmp/cw-counts.txt && echo "Chatwoot: conteos iguales" || { echo "Chatwoot: CONTEOS DISTINTOS"; fail=1; }
# credenciales cifradas (IA, Meta, Chatwoot) descifrables con LOOPCHAT_ENCRYPTION_KEYS de .env.production
$LC run --rm -T app sh -c 'RESTORE_DATABASE_URL="$DATABASE_URL" npm run --silent verify:restore' || fail=1
[ "$fail" = 0 ] || die "verificación fallida: NO cambiar el webhook de Meta; ver rollback en docs/migracion-vps.md"

say "5) Levantar servicios y re-apuntar el webhook Chatwoot → Loopchat a $APP_URL"
$CW up -d
until curl -sf -o /dev/null http://127.0.0.1:3001/api; do sleep 3; done
$CW exec -T -e LC_URL="$APP_URL" rails bundle exec rails runner \
  "n=0; Webhook.where('url LIKE ?', '%/api/webhooks/chatwoot/%').find_each { |w| u = w.url.sub(%r{\Ahttps?://[^/]+}, ENV['LC_URL']); (w.update!(url: u); n += 1) if u != w.url }; puts %(webhooks_actualizados=#{n})"
$LC up -d
until curl -sf -o /dev/null http://127.0.0.1:3000/api/health; do sleep 3; done
echo
echo "OK. Loopchat y Chatwoot corriendo con los datos de la PC."
echo "Siguiente (manual): validar en el navegador y recién ahí cambiar el webhook de cada número en Meta (docs/migracion-vps.md)."
