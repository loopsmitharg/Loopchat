#!/usr/bin/env bash
# Aprovisionamiento del VPS de Loopchat (Ubuntu 24.04). Idempotente: se puede volver a correr.
# Uso (como deploy, en el VPS):  sudo bash provision.sh [<commit-o-rama>]
# Hace: updates dentro de 24.04 (sin pasar a 26.04), swap, firewall IPv4/IPv6 (SSH abierto; 80/443 solo
# desde Cloudflare), fail2ban, Docker Engine + Compose y Caddy de sus repos oficiales, directorios y clonado.
# NO: reinicia, migra bases, crea .env, ni levanta Loopchat/Chatwoot. Caddy queda instalado pero detenido
# hasta tener el certificado de origen de Cloudflare.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Correr con sudo"; exit 1; }
REF="${1:-fix/loopchat-production-readiness}"
APP_USER=deploy
REPO=https://github.com/loopsmitharg/Loopchat.git
REPORT=/home/$APP_USER/provision-report.txt
export DEBIAN_FRONTEND=noninteractive
log() { printf '\n== %s\n' "$*"; }

log "1. Ubuntu: actualizaciones dentro de 24.04"
. /etc/os-release
[ "$VERSION_ID" = "24.04" ] || { echo "Se esperaba Ubuntu 24.04 (es $VERSION_ID)"; exit 1; }
# nunca ofrecer el salto a 26.04: se decide aparte
sed -i 's/^Prompt=.*/Prompt=never/' /etc/update-manager/release-upgrades
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl gnupg git ufw fail2ban unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

log "2. Swap de 2 GB (no había)"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-loopchat-swap.conf && sysctl -q -p /etc/sysctl.d/90-loopchat-swap.conf
fi

log "3. Firewall (IPv4 + IPv6)"
SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{p=$2} END{print p}'); SSH_PORT=${SSH_PORT:-22}  # awk lee todo: un exit temprano corta el pipe y pipefail aborta
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
# SSH primero (con límite de intentos) para no perder el acceso al habilitar
ufw limit "$SSH_PORT/tcp" comment 'SSH' >/dev/null
# 80/443 solo desde Cloudflare: el origen no se puede usar salteando el proxy
CF_IPS=$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4; echo; curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)
[ "$(echo "$CF_IPS" | grep -c /)" -ge 15 ] || { echo "No se pudo leer la lista de IPs de Cloudflare"; exit 1; }
for net in $CF_IPS; do ufw allow proto tcp from "$net" to any port 80,443 comment 'Cloudflare' >/dev/null; done
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

log "4. Docker Engine + Compose (repo oficial de Docker)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q && apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# rotación de logs de contenedores (si no, crecen sin límite)
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "5" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker containerd >/dev/null
usermod -aG docker "$APP_USER"

log "5. Caddy (repo oficial), detenido hasta tener el certificado"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get -y -q install caddy
fi
if [ ! -f /etc/caddy/cf-origin.pem ]; then systemctl disable --now caddy >/dev/null 2>&1 || true; fi

log "6. Directorios"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 /opt/loopchat
install -d -o "$APP_USER" -g "$APP_USER" -m 700 /var/backups/loopchat
install -d -o root -g "$APP_USER" -m 750 /etc/loopchat

log "7. Repositorio en /opt/loopchat ($REF)"
if [ ! -d /opt/loopchat/.git ]; then sudo -u "$APP_USER" git clone -q "$REPO" /opt/loopchat; fi
sudo -u "$APP_USER" git -C /opt/loopchat fetch -q origin
sudo -u "$APP_USER" git -C /opt/loopchat checkout -q "$REF"
sudo -u "$APP_USER" git -C /opt/loopchat pull -q --ff-only 2>/dev/null || true

log "Informe → $REPORT"
{
  echo "fecha: $(date -Is)"
  echo "so: $(lsb_release -ds) | kernel en uso: $(uname -r) | reinicio pendiente: $([ -f /var/run/reboot-required ] && echo SI || echo no)"
  echo "release-upgrades: $(grep ^Prompt /etc/update-manager/release-upgrades)"
  echo "swap: $(swapon --show --noheadings | awk '{print $1, $3}')"
  echo "ssh: puerto $SSH_PORT | $(sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) ' | tr '\n' ' ')"
  echo "--- ufw"; ufw status verbose
  echo "--- fail2ban: $(fail2ban-client status 2>/dev/null | tr -d '\t' | tr '\n' ' ')"
  echo "--- docker: $(docker --version) | $(docker compose version) | grupo docker: $(id -nG $APP_USER | tr ' ' ',')"
  echo "--- caddy: $(caddy version) | servicio: $(systemctl is-active caddy || true) / $(systemctl is-enabled caddy || true)"
  echo "--- repo: $(sudo -u $APP_USER git -C /opt/loopchat log -1 --format='%h %s')"
  echo "--- dirs:"; ls -ld /opt/loopchat /var/backups/loopchat /etc/loopchat
  echo "--- puertos en escucha:"; ss -tlnp | awk 'NR>1{print $4, $6}'
} > "$REPORT" 2>&1
chown "$APP_USER": "$REPORT"
cat "$REPORT"
