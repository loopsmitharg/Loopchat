#!/usr/bin/env bash
# Prueba de punta a punta del backup a R2 con adjuntos incrementales de Chatwoot y su restore. Todo en Docker y aislado:
# PostgreSQL 16 (pgvector) propio, R2 simulado con un remoto rclone local y la API de métricas de Cloudflare simulada.
# No toca las bases, volúmenes ni webhooks del entorno local. Usa los scripts del árbol de trabajo (montados).
#
# Uso: IMAGE=loopchat-app:backup-test bash tests/ops/backup-r2-e2e.sh   (npm run test:backup)
#   IMAGE: imagen de la app (docker build -f infra/loopchat/Dockerfile -t loopchat-app:backup-test .)
#   CW_SCHEMA_DUMP (opcional): dump real de Chatwoot (-Fc) para usar su esquema y mensajes en vez del mínimo
set -euo pipefail
IMAGE="${IMAGE:-loopchat-app:backup-test}"
ROOT="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
P="lcbk$$"
export MSYS_NO_PATHCONV=1
PASS=0
ok() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
die() { echo "  ✗ $1" >&2; exit 1; }
cleanup() { docker rm -f "$P-db" "$P-app" >/dev/null 2>&1 || true; docker volume rm "$P-t" "$P-cw" >/dev/null 2>&1 || true; docker network rm "$P" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$P" >/dev/null
docker run -d --name "$P-db" --network "$P" -e POSTGRES_PASSWORD=test pgvector/pgvector:pg16 >/dev/null
docker volume create "$P-t" >/dev/null; docker volume create "$P-cw" >/dev/null
docker run -d --name "$P-app" --network "$P" -u root \
  -v "$P-t:/t" -v "$P-cw:/cw" \
  -v "$ROOT/scripts:/app/scripts:ro" -v "$ROOT/src/server/ops:/app/src/server/ops:ro" -v "$ROOT/tests/ops:/app/tests/ops:ro" \
  -e DATABASE_URL=postgres://postgres:test@$P-db:5432/loopchat -e CHATWOOT_DATABASE_URL=postgres://postgres:test@$P-db:5432/chatwoot \
  -e LOOPCHAT_ENCRYPTION_KEYS=k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= -e BETTER_AUTH_SECRET=backup-e2e-secret-backup-e2e-secret-xx \
  -e BACKUP_DIR=/t/backups -e BACKUP_PUBLIC_KEY=/t/keys/pub.pem -e BACKUP_SKIP_HEARTBEAT=true -e STORAGE_DIR=/t/lc-storage \
  -e CHATWOOT_STORAGE_DIR=/cw -e RCLONE_CONFIG_R2_TYPE=alias -e RCLONE_CONFIG_R2_REMOTE=/t/remote -e RCLONE_CONFIG=/dev/null \
  -e RCLONE_REMOTE=r2:loopchat-backups/prod -e R2_ACCOUNT_ID=test -e R2_ANALYTICS_TOKEN=test -e R2_GRAPHQL_URL=http://127.0.0.1:8787 \
  --entrypoint sleep "$IMAGE" infinity >/dev/null
as_root() { docker exec -u root "$P-app" bash -c "$1"; }
as_app() { docker exec -u loopchat "$P-app" bash -c "$1"; } # el backup corre como en producción (uid 1001, storage de Chatwoot de solo lectura)
psql_cw() { as_root "psql -XAtq postgres://postgres:test@$P-db:5432/chatwoot -c \"$1\""; }

echo "Preparando entorno aislado ($IMAGE)"
for _ in $(seq 30); do as_root "pg_isready -q -h $P-db" && break; sleep 1; done
as_root "mkdir -p /t/keys /t/backups /t/remote/loopchat-backups /t/lc-storage \
  && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /t/keys/priv.pem 2>/dev/null && openssl pkey -in /t/keys/priv.pem -pubout -out /t/keys/pub.pem \
  && chown -R loopchat /t \
  && psql -q postgres://postgres:test@$P-db:5432/postgres -c 'create database loopchat' -c 'create database chatwoot' \
  && cd /app && npm run --silent db:migrate >/dev/null"
if [ -n "${CW_SCHEMA_DUMP:-}" ]; then
  docker cp "$CW_SCHEMA_DUMP" "$P-app:/t/cw-schema.dump"
  as_root "pg_restore --no-owner --no-privileges -d postgres://postgres:test@$P-db:5432/chatwoot /t/cw-schema.dump" || true
else # esquema mínimo con las columnas que usa Chatwoot para mensajes y adjuntos (ActiveStorage)
  psql_cw "create extension vector;
    create table messages (id bigserial primary key, account_id int not null, content text);
    create table attachments (id bigserial primary key, file_type int default 0, message_id bigint not null, account_id int not null, created_at timestamp not null, updated_at timestamp not null);
    create table active_storage_blobs (id bigserial primary key, key varchar not null unique, filename varchar not null, content_type varchar, metadata text, service_name varchar not null, byte_size bigint not null, checksum varchar, created_at timestamp not null);
    create table active_storage_attachments (id bigserial primary key, name varchar not null, record_type varchar not null, record_id bigint not null, blob_id bigint not null, created_at timestamp not null);
    insert into messages (account_id, content) select 1, 'mensaje ' || g from generate_series(1, 5) g;"
fi
as_root "nohup setsid node /app/tests/ops/mock-cloudflare-graphql.mjs >/dev/null 2>&1 &"

# Crea un adjunto real: archivo en la ruta de ActiveStorage + blob con MD5 + attachment del mensaje N (orden por id)
add_attachment() { # $1 = key, $2 = tamaño en bytes, $3 = índice de mensaje
  as_root "d=/cw/${1:0:2}/${1:2:2}; mkdir -p \$d; { echo LOOPCHAT-PLAINTEXT-MARKER; head -c $2 /dev/urandom; } > \$d/$1"
  local sum size
  sum="$(as_root "openssl dgst -md5 -binary /cw/${1:0:2}/${1:2:2}/$1 | base64")"
  size="$(as_root "stat -c %s /cw/${1:0:2}/${1:2:2}/$1")"
  psql_cw "with b as (insert into active_storage_blobs (key, filename, content_type, metadata, service_name, byte_size, checksum, created_at)
      values ('$1', '$1.jpg', 'image/jpeg', '{}', 'local', $size, '$sum', now()) returning id),
    a as (insert into attachments (file_type, message_id, account_id, created_at, updated_at)
      select 0, id, account_id, now(), now() from messages order by id offset $3 limit 1 returning id)
    insert into active_storage_attachments (name, record_type, record_id, blob_id, created_at) select 'file', 'Attachment', a.id, b.id, now() from a, b"
}
mode() { as_root "echo $1 > /t/mock-mode"; }
backup() { as_app "cd /app && bash scripts/backup.sh 2>&1"; }
remote_media() { as_root "find /t/remote/loopchat-backups/prod/media -name '*.enc' 2>/dev/null | wc -l"; }

echo "1) Primer backup: sube base + adjuntos cifrados"
add_attachment k1aa0000000000000000000000 200000 0
add_attachment k2bb0000000000000000000000 35 1
add_attachment k3cc0000000000000000000000 5000000 1
mode ok
out="$(backup)" || { echo "$out"; die "el primer backup falló"; }
[ "$(remote_media)" = 3 ] && ok "3 adjuntos en R2" || die "se esperaban 3 adjuntos, hay $(remote_media)"
echo "$out" | grep -q "adjuntos: 3 nuevos" && ok "resumen informa 3 nuevos" || die "resumen sin adjuntos: $out"
as_root "! grep -rqa LOOPCHAT-PLAINTEXT-MARKER /t/remote" && ok "ningún adjunto en claro en R2" || die "hay adjuntos sin cifrar en R2"
as_root "for f in \$(find /cw -type f); do r=\${f#/cw/}; e=/t/remote/loopchat-backups/prod/media/\$r.enc; n=\$(stat -c %s \$f); [ \$(stat -c %s \$e) -eq \$((384 + (n / 16 + 1) * 16)) ] || exit 1; done" \
  && ok "tamaño cifrado exacto (lo que usa la detección de subidas incompletas)" || die "tamaño cifrado inesperado"

echo "2) Segundo backup sin cambios: no vuelve a subir nada"
before="$(as_root "find /t/remote/loopchat-backups/prod/media -type f -printf '%P %T@\n' | sort")"
out="$(backup)" || die "el segundo backup falló"
echo "$out" | grep -q "adjuntos: 0 nuevos" && ok "0 adjuntos nuevos" || die "volvió a subir adjuntos: $out"
[ "$before" = "$(as_root "find /t/remote/loopchat-backups/prod/media -type f -printf '%P %T@\n' | sort")" ] && ok "objetos de R2 intactos (sin re-subida)" || die "se reescribieron adjuntos"

echo "3) Adjunto nuevo + subida incompleta previa: sube solo esos dos"
add_attachment k4dd0000000000000000000000 70000 2
as_root "truncate -s 100 /t/remote/loopchat-backups/prod/media/k2/bb/k2bb0000000000000000000000.enc"
out="$(backup)" || die "el tercer backup falló"
echo "$out" | grep -q "adjuntos: 2 nuevos" && ok "sube el nuevo y repara el incompleto" || die "esperaba 2 nuevos: $out"

echo "4) Adjunto borrado en Chatwoot (archivo y registros): se conserva en R2 durante la retención"
as_root "rm /cw/k1/aa/k1aa0000000000000000000000"
psql_cw "delete from attachments where id in (select record_id from active_storage_attachments sa join active_storage_blobs b on b.id = sa.blob_id where b.key = 'k1aa0000000000000000000000');
  delete from active_storage_attachments where blob_id in (select id from active_storage_blobs where key = 'k1aa0000000000000000000000');
  delete from active_storage_blobs where key = 'k1aa0000000000000000000000'"
out="$(backup)" || die "el cuarto backup falló"
[ "$(remote_media)" = 4 ] && ok "el huérfano sigue en R2 (los backups de esos días lo referencian)" || die "borró un adjunto dentro de la retención"
as_root "grep -q k1aa /t/backups/r2-media-orphans.json" && ok "huérfano registrado con su fecha" || die "no registró el huérfano"

echo "5) Sin espacio en la cuenta: no sube adjuntos ni base y no borra copias válidas"
add_attachment k5ee0000000000000000000000 1000 3
mode full
snap="$(as_root "find /t/remote -type f | sort | md5sum")"
if backup >/dev/null; then die "subió sin espacio"; fi
[ "$snap" = "$(as_root "find /t/remote -type f | sort | md5sum")" ] && ok "R2 sin cambios" || die "R2 cambió sin espacio"
mode down
if backup >/dev/null; then die "subió sin poder medir"; fi
ok "API de métricas caída: falla cerrada"
mode ok
out="$(backup)" || die "el backup de recuperación falló"
ok "con espacio vuelve a subir ($(echo "$out" | grep -o 'adjuntos: [0-9]* nuevos'))"

echo "6) Restore desde lo bajado de R2: mensajes + archivos con MD5 original"
as_root "mkdir -p /t/dl && chown loopchat /t/dl"
as_app "rclone copy r2:loopchat-backups/prod /t/dl --max-depth 1 --max-age 2d --include 'loopchat-*' && rclone copy r2:loopchat-backups/prod/media /t/dl/media --fast-list"
rt="cd /app && BACKUP_SKIP_HEARTBEAT=true BACKUP_DIR=/t/dl BACKUP_PRIVATE_KEY=/t/keys/priv.pem RESTORE_TEST_ADMIN_URL=postgres://postgres:test@$P-db:5432/postgres RESTORE_TEST_CHATWOOT_ADMIN_URL=postgres://postgres:test@$P-db:5432/postgres bash scripts/backup-restore-test.sh 2>&1"
out="$(as_app "$rt")" || { echo "$out"; die "la prueba de restore falló"; }
echo "$out" | grep -E "Chatwoot restaurado|Archivos:" | sed 's/^/    /'
echo "$out" | grep -q "0 faltan, 0 con MD5 distinto" && ok "todos los adjuntos recuperados y verificados" || die "restore incompleto"
echo "$out" | grep -qE "[1-9][0-9]* con adjuntos" && ok "mensajes con adjuntos recuperados" || die "sin mensajes con adjuntos"

echo "7) Un adjunto corrupto en R2 hace fallar la prueba de restore"
as_root "f=/t/dl/media/k4/dd/k4dd0000000000000000000000.enc; printf 'XXXXXXXXXXXXXXXX' | dd of=\$f bs=1 seek=500 conv=notrunc 2>/dev/null"
if as_app "$rt" >/dev/null 2>&1; then die "no detectó el adjunto corrupto"; fi
ok "corrupción detectada"

echo "OK: $PASS comprobaciones"
