# Migración PC → VPS (Loopchat + Chatwoot + Todo Trabajo)

Mudanza **completa y conjunta** del entorno local que funciona hoy (Todo Trabajo, 7 bots, equipo multiagente, IA real,
dos números de WhatsApp) a un VPS. No se reconstruye nada: se restauran las dos bases juntas con los **mismos secretos**.

> Por qué juntas: Loopchat guarda los IDs de cuenta/inbox de Chatwoot y Chatwoot guarda los tokens de Meta y la Platform App.
> Restaurar una sola deja referencias rotas. Por qué los mismos secretos: las credenciales de IA/Meta/Chatwoot están cifradas
> con `LOOPCHAT_ENCRYPTION_KEYS` (Loopchat) y `ACTIVE_RECORD_ENCRYPTION_*` (Chatwoot); con otras claves no se pueden leer.

Herramientas (en el repo):

| Paso | Archivo |
|---|---|
| Exportar y cortar en la PC | `scripts/migration/export-local.ps1` |
| Importar y verificar en el VPS | `scripts/migration/import-vps.sh` |
| Conteos de integridad | `scripts/migration/loopchat-counts.sql`, `chatwoot-counts.sql` |
| Variables de producción | `infra/loopchat/env.production.example`, `infra/chatwoot/chatwoot.env.example` |
| Proxy TLS con dominios por variable | `infra/caddy/Caddyfile`, `infra/caddy/caddy-env.conf` |

## Checklist del VPS (en orden)

**A. Lo que aportan ustedes**
- [ ] VPS Ubuntu 24.04, **4 vCPU / 8 GB RAM / ≥ 80 GB SSD** + 2 GB de swap, acceso SSH con clave (medición: ~1,4 GB en uso con todo levantado; ver `docs/execution-status.md`, cierre de Fase 1).
- [x] Dominios confirmados: `app.loopchat.com.ar` (Loopchat), `chatwoot.loopchat.com.ar` (Chatwoot); correo desde `no-reply@loopchat.com.ar`.
- [ ] Cloudflare: registros A (proxied) y un *Origin Certificate* para ambos dominios; SSL/TLS en **Full (strict)**.
- [x] Resend: dominio `loopchat.com.ar` verificado (región São Paulo); la API key está en el `.env` privado de la PC y se copia al VPS por el gestor de secretos. Remitente `Loopchat <no-reply@loopchat.com.ar>`.
- [ ] Destino de alertas: `ALERT_EMAIL` y/o `ALERT_WEBHOOK_URL`.
- [ ] Bucket externo para backups (R2 o B2) + credenciales de `rclone`; par de claves RSA de backup (la privada fuera del servidor).
- [ ] Gestor de secretos con: `.env` local, `infra/chatwoot/.env` local, API key de Resend, claves de backup.
- [ ] Email real de quien será superadmin y del admin de Todo Trabajo (hoy son cuentas de prueba).

**B. Servidor** — HECHO el 2026-11-25 en el VPS de Contabo (`212.28.183.78`, Ubuntu 24.04.5, 6 vCPU / 11 GiB / 193 GB)
```bash
# previo (a mano): usuario deploy con sudo y clave SSH; PermitRootLogin no; PasswordAuthentication no
scp scripts/vps/provision.sh deploy@<IP>:~ && ssh -t deploy@<IP> "sudo bash ~/provision.sh"   # idempotente
sudo reboot    # si el informe dice "reinicio pendiente: SI"
```
`scripts/vps/provision.sh`: updates de 24.04 sin salto a 26.04 (`Prompt=never`), swap 2 GB, ufw IPv4/IPv6 (SSH con
límite; 80/443 **solo desde las IPs de Cloudflare**), fail2ban, Docker Engine + Compose (repo oficial, logs rotados),
Caddy (repo oficial, **detenido** hasta tener el certificado de origen), `/opt/loopchat`, `/etc/loopchat`,
`/var/backups/loopchat` y el clonado del repo. Deja un informe en `~/provision-report.txt`.

**C. Proxy y dominios** — HECHO el 2026-11-25 (Caddy configurado y validado, **deshabilitado** hasta el corte)
- Cloudflare: SSL/TLS **Full (strict)**; *Origin Certificate* ECC hasta 2041 para `loopchat.com.ar`, `*.loopchat.com.ar`,
  `app.` y `chatwoot.`; registros proxied. Originales guardados fuera del servidor (gestor de secretos).
```bash
scp cf-origin.pem cf-origin.key scripts/vps/install-caddy.sh deploy@<IP>:~
ssh -t deploy@<IP> "sudo bash ~/install-caddy.sh"   # verifica el par, instala, valida como caddy y borra las copias
# en el corte, con las apps listas:  sudo systemctl enable --now caddy
```

**D. Variables** (sección 0 abajo): `.env.production` desde `infra/loopchat/env.production.example` e `infra/chatwoot/.env` desde
la copia local + SMTP de Resend. `chmod 600` a ambos.

**E. Corte y migración:** sección 1 (export en la PC → `scp` → `import-vps.sh` → validación → webhook de Meta → prueba real).

**F. Después del corte**
- [ ] Corregir cuentas de prueba sin perder datos: **`docs/correccion-cuentas-demo.md`** (superadmin real, email real del admin de Todo Trabajo y del superadmin de Chatwoot).
- [ ] Borrar las empresas `DEMO Ferretería Norte` y `DEMO Óptica Sur` (sus cuentas de Chatwoot son del simulador y el worker registra `Invalid Access Token` cada vez que intenta sincronizarlas).
- [ ] Todo Trabajo: borrar la conexión *Simulador de IA local*.
- [ ] Probar un reset de contraseña real (prueba de Resend en producción).
- [ ] Backups: `docs/operations.md` § Backups (timer + restore de prueba).
- [ ] Checklist de validación de `docs/qa-final.md`.

## 0. Antes del día del corte (sin impacto)

1. VPS listo (Docker, Caddy, firewall), repo clonado en `/opt/loopchat` en el **mismo commit** que corre en la PC.
2. DNS y certificado de origen listos; `https://app.loopchat.com.ar` y `https://chatwoot.loopchat.com.ar` resuelven al VPS (aunque den 502).
3. `/opt/loopchat/.env.production` desde `infra/loopchat/env.production.example`:
   - `BETTER_AUTH_SECRET`, `LOOPCHAT_ENCRYPTION_KEYS`, `CHATWOOT_PLATFORM_TOKEN`: **copiados del `.env` de la PC**.
   - dominios nuevos, `LOOPCHAT_DB_PASSWORD` nueva, `SMTP_URL`/`MAIL_FROM` de Resend.
4. `/opt/loopchat/infra/chatwoot/.env`: **copia del `infra/chatwoot/.env` de la PC**, cambiando solo `FRONTEND_URL=https://chatwoot.loopchat.com.ar`
   y agregando el bloque SMTP de Resend. `SECRET_KEY_BASE` y las tres `ACTIVE_RECORD_ENCRYPTION_*` **no se cambian**.
5. `chmod 600` a los dos `.env`. Los secretos viajan por el gestor de secretos (nunca por mail/chat ni dentro del paquete).
6. Ensayo opcional: correr el import en el VPS con un paquete de prueba y luego `docker compose … down -v` (solo en el VPS, antes del corte real).

## 1. Corte (ventana: ~30 min sin bots)

Orden pensado para que **nunca respondan la PC y el VPS a la vez**: Meta manda cada mensaje a una sola URL de webhook, y
la PC queda apagada y bloqueada antes de que el VPS arranque.

1. **PC — exportar y cortar:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\migration\export-local.ps1
   ```
   Detiene web, worker, túneles y Chatwoot; vuelca las bases y archivos a `storage\migration\<fecha>`; escribe
   `storage\run\MIGRATED_TO_VPS` (desde ahí `dev-start.ps1` se niega a arrancar). Los mensajes que entren ahora fallan en el
   túnel caído y **Meta los reintenta** (hasta ~7 días), así que no se pierden: llegan al VPS cuando se cambie el webhook.
2. **Copiar el paquete** (contiene datos de clientes: solo por SSH):
   ```powershell
   scp -r storage\migration\<fecha> deploy@<IP-VPS>:/home/deploy/
   ```
3. **VPS — importar y verificar:**
   ```bash
   cd /opt/loopchat && bash scripts/migration/import-vps.sh /home/deploy/<fecha>
   ```
   Verifica SHA256 del paquete, versión de Chatwoot y que las bases destino estén vacías; restaura Chatwoot y Loopchat,
   corre migraciones, compara conteos fila a fila contra los de la PC, comprueba que **todas** las credenciales cifradas se
   descifren, levanta los servicios y re-apunta el webhook Chatwoot → Loopchat a `APP_URL`.
   Si algo no coincide, termina con error **antes** de levantar servicios → ir a Rollback.
4. **Validación en el navegador (antes de tocar Meta):** login, Todo Trabajo → Configuración → IA → *Probar* `PruebaOficial`;
   WhatsApp → *Verificar* cada número; bots y equipo publicados; conversaciones e historial visibles.
5. **Meta — cambiar el webhook** de cada número a `https://chatwoot.loopchat.com.ar/webhooks/whatsapp/<número sin +>` con el mismo
   Verify Token del inbox (en la UI de Chatwoot). Repetir para los dos números.
6. **Prueba real:** WhatsApp desde un celular a cada número → respuesta del bot; derivación a persona; oportunidad en el pipeline.
7. Recién ahí: activar backups (`docs/operations.md` § Backups) y borrar el paquete del VPS (`rm -rf /home/deploy/<fecha>`).

## 2. Validaciones de integridad (automáticas en `import-vps.sh`)

- `sha256sum -c SHA256SUMS`: el paquete llegó completo.
- Conteos idénticos PC ↔ VPS en 22 tablas de Loopchat (empresas, usuarios, bots y versiones, equipos, reglas y conocimiento,
  productos, pipelines, oportunidades, contactos, conversaciones, mensajes, conexiones) y 13 de Chatwoot (cuentas, usuarios,
  inboxes, canales WhatsApp, webhooks, Platform App, contactos, conversaciones, mensajes, adjuntos).
- `npm run verify:restore`: 0 credenciales sin descifrar (IA, Meta, Chatwoot).
- `/api/health` de Loopchat y `/api` de Chatwoot responden.

## 3. Rollback

**Antes del paso 5 (Meta sin cambiar):** sin pérdida. En la PC:
```powershell
Remove-Item storage\run\MIGRATED_TO_VPS
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-start.ps1
```
y actualizar el webhook de Meta a la nueva URL del túnel (`docs/local-whatsapp-setup/04_META_CONFIGURATION.md`; los túneles
cambian de URL en cada arranque). En el VPS: `docker compose … down` (sin `-v` si se quiere investigar).

**Después del paso 5 (el VPS ya procesó mensajes reales):** volver a la PC sin más pasos perdería esas conversaciones.
Hacer el camino inverso: en el VPS `npm run backup` (o `pg_dump` de ambas bases), restaurar en la PC sobre bases vacías y recién
ahí el rollback de arriba. Preferir corregir en el VPS salvo falla grave.

## 4. Datos que no migran

- Cola de trabajos de Sidekiq (Redis de Chatwoot): se descarta; lo pendiente lo reintenta Meta.
- Archivos de conocimiento de Loopchat: hoy no hay subidos (todo el conocimiento de Todo Trabajo es texto en la base). Si se
  suben antes del corte, el export los incluye (`storage/knowledge`, `storage/products`).
- `storage/run`, `storage/tunnels`, `storage/backups` de la PC: son locales, no se migran.
