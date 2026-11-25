#!/usr/bin/env bash
# Verifica un restore de Chatwoot: cada archivo que la base referencia (active_storage_blobs, servicio local) existe en el
# storage restaurado con el MD5 que Chatwoot guardó al subirlo, y cuenta cuántos mensajes recuperan todos sus adjuntos.
# Uso: scripts/verify-chatwoot-media.sh <url de la base de Chatwoot restaurada> <storage de Chatwoot restaurado>
set -euo pipefail
DB="${1:?url de la base de Chatwoot restaurada}"
DIR="${2:?directorio del storage restaurado}"

ok=0; missing=0; bad=0; bad_msgs=""
# ActiveStorage (disco): <raíz>/<key[0..1]>/<key[2..3]>/<key>; checksum = base64(MD5 binario)
while IFS='|' read -r key checksum msg; do
  f="$DIR/${key:0:2}/${key:2:2}/$key"
  if [ ! -f "$f" ]; then missing=$((missing + 1)); bad_msgs="$bad_msgs $msg"; continue; fi
  if [ "$(openssl dgst -md5 -binary "$f" | base64)" != "$checksum" ]; then bad=$((bad + 1)); bad_msgs="$bad_msgs $msg"; continue; fi
  ok=$((ok + 1))
done < <(psql "$DB" -XAt -F '|' -c "
  select b.key, b.checksum, coalesce(a.message_id::text, '-')
  from active_storage_blobs b
  left join active_storage_attachments sa on sa.blob_id = b.id and sa.record_type = 'Attachment'
  left join attachments a on a.id = sa.record_id
  where b.service_name = 'local' and b.checksum is not null")

read -r msgs att_msgs atts < <(psql "$DB" -XAt -F ' ' -c "
  select (select count(*) from messages), count(distinct a.message_id), count(*)
  from attachments a join active_storage_attachments sa on sa.record_type = 'Attachment' and sa.record_id = a.id")
echo "Chatwoot restaurado: $msgs mensajes, $att_msgs con adjuntos ($atts adjuntos)"
echo "Archivos: $ok OK, $missing faltan, $bad con MD5 distinto"
if [ $((missing + bad)) -gt 0 ]; then
  echo "Mensajes afectados:$(echo "$bad_msgs" | tr ' ' '\n' | sort -u | grep -v '^-\?$' | tr '\n' ' ')" >&2
  exit 1
fi
