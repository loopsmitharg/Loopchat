#!/usr/bin/env bash
# Instala en Caddy el certificado de origen de Cloudflare y el Caddyfile del repo, y valida. Caddy queda DESHABILITADO
# (se habilita en el corte). Uso, como deploy en el VPS, con cf-origin.pem y cf-origin.key subidos a ~:
#   sudo bash /opt/loopchat/scripts/vps/install-caddy.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Correr con sudo"; exit 1; }
SRC=/home/deploy
REPO=/opt/loopchat
for f in cf-origin.pem cf-origin.key; do [ -s "$SRC/$f" ] || { echo "Falta $SRC/$f"; exit 1; }; done
# el certificado tiene que corresponder a la clave
[ "$(openssl x509 -in $SRC/cf-origin.pem -noout -pubkey | sha256sum)" = "$(openssl pkey -in $SRC/cf-origin.key -pubout | sha256sum)" ] \
  || { echo "El certificado no corresponde a la clave"; exit 1; }

install -m 644 -o root -g root "$REPO/infra/caddy/Caddyfile" /etc/caddy/Caddyfile
install -m 600 -o caddy -g caddy "$SRC/cf-origin.pem" /etc/caddy/cf-origin.pem
install -m 600 -o caddy -g caddy "$SRC/cf-origin.key" /etc/caddy/cf-origin.key
printf 'APP_DOMAIN=app.loopchat.com.ar\nCHATWOOT_DOMAIN=chatwoot.loopchat.com.ar\n' > /etc/caddy/caddy.env
install -d /etc/systemd/system/caddy.service.d
install -m 644 "$REPO/infra/caddy/caddy-env.conf" /etc/systemd/system/caddy.service.d/env.conf
systemctl daemon-reload

# validar como el usuario del servicio (comprueba también que pueda leer el certificado)
sudo -u caddy env $(cat /etc/caddy/caddy.env) caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
shred -u "$SRC/cf-origin.pem" "$SRC/cf-origin.key"
echo "OK: Caddy configurado y validado; copias en $SRC borradas. Estado: $(systemctl is-active caddy || true)/$(systemctl is-enabled caddy || true)"
