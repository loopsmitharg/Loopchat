# Corrección de cuentas de prueba sin perder datos

Se hace **en el VPS, después del corte** (paso F de `docs/migracion-vps.md`) y **antes** de borrar las empresas DEMO.
Requisito: Resend ya configurado en Loopchat y en Chatwoot (los tres pasos terminan con un email de restablecer contraseña real).

Estado relevado en la base local (2026-11-23):

| Cuenta | Dónde | Problema |
|---|---|---|
| `plataforma@demo.loopchat.test` | Loopchat, superadmin | Contraseña pública del seed de demo (`seed-demo.ts`) |
| `admin@todotrabajo.localhost` | Loopchat, `tenant_admin` de Todo Trabajo | Email que no recibe correo: no puede restablecer contraseña |
| `superadmin@loopchat.localhost` | Chatwoot, `SuperAdmin` (consola `/super_admin`) | Mismo problema |

Los usuarios `svc-…@loopchat-service.invalid` de Chatwoot son cuentas de servicio de Loopchat: **no se tocan**.

> **Por qué no "invitar uno nuevo y borrar el viejo"**: `memberships`, `session` y `account` se borran en cascada con el
> usuario, y 17 columnas (autor de mensajes y notas, asignaciones, publicaciones de bots, auditoría) pasan a `NULL`.
> Cambiar el email **en el mismo registro** conserva el id y con él todo el historial. En Loopchat el login por contraseña
> usa `account.account_id = user.id`, así que alcanza con cambiar `user.email`.

Atajos usados abajo (desde `/opt/loopchat`):

```bash
LC="docker compose -p loopchat -f infra/loopchat/docker-compose.yml --env-file .env.production"
CW="docker compose -p chatwoot --project-directory infra/chatwoot -f infra/chatwoot/docker-compose.yml"
PSQL="$LC exec -T db psql -U loopchat -d loopchat -v ON_ERROR_STOP=1"
```

## 0. Antes de empezar

- [ ] Backup recién hecho de ambas bases (`docs/operations.md` § Backups).
- [ ] Guardar los conteos para comparar al final:
  `$PSQL -At < scripts/migration/loopchat-counts.sql > /tmp/antes.txt`

## 1. Superadmin real de Loopchat y baja del de demo

- [ ] Crear el superadmin real (la contraseña se pide por teclado: no queda en el historial ni en `.env`):
  ```bash
  read -rp "Email: " E; read -rsp "Contraseña (mín. 10): " P; echo
  $LC run --rm -T -e BOOTSTRAP_ADMIN_EMAIL="$E" -e BOOTSTRAP_ADMIN_PASSWORD="$P" app npm run bootstrap:admin; unset P
  ```
- [ ] Entrar a `https://app.loopchat.com.ar/admin` con la cuenta nueva y ver las empresas.
- [ ] Probar *¿Olvidaste tu contraseña?* con la cuenta nueva → llega el mail desde `notify.loopchat.com.ar`.
- [ ] Recién entonces, dar de baja la de demo (no tiene membresías; solo se pierde su autoría en la auditoría):
  ```bash
  $PSQL -c "delete from \"user\" where email = 'plataforma@demo.loopchat.test'"
  ```
- [ ] Comprobar: `$PSQL -At -c "select u.email from platform_admins p join \"user\" u on u.id = p.user_id"` → solo la real.

## 2. Admin de Todo Trabajo: cambiar el email en el mismo usuario

- [ ] Verificar que el email nuevo no exista ya (si existe, parar y revisar):
  ```bash
  NEW="nombre@empresa-real"   # en minúsculas
  $PSQL -At -c "select count(*) from \"user\" where email = '$NEW'"     # debe dar 0
  ```
- [ ] Cambiar el email y cerrar sus sesiones, en una sola transacción:
  ```bash
  $PSQL <<SQL
  begin;
  update "user" set email = '$NEW', email_verified = false, updated_at = now()
   where email = 'admin@todotrabajo.localhost';
  delete from session where user_id = (select id from "user" where email = '$NEW');
  select u.email, m.role, t.name from "user" u join memberships m on m.user_id = u.id join tenants t on t.id = m.tenant_id
   where u.email = '$NEW';
  commit;
  SQL
  ```
  Debe mostrar `tenant_admin | Todo Trabajo`. Si el `update` dijo `UPDATE 0`, no hubo cambios.
- [ ] En `https://app.loopchat.com.ar/restablecer` pedir el restablecimiento para `$NEW` → mail recibido → contraseña nueva →
  login. Esto invalida la contraseña local guardada en `storage/todo-trabajo-admin.local.txt` de la PC (borrar ese archivo).
- [ ] Dentro de Todo Trabajo: bots, equipo, conversaciones asignadas e historial siguen visibles con el mismo usuario.

## 3. Superadmin de Chatwoot

- [ ] Cambiar el email sin pedir reconfirmación (Devise) y confirmar:
  ```bash
  read -rp "Email nuevo: " NEW_CW
  $CW exec -T -e NEW_CW="$NEW_CW" rails bundle exec rails runner '
    u = User.find_by!(email: "superadmin@loopchat.localhost")
    u.skip_reconfirmation!
    u.update!(email: ENV.fetch("NEW_CW"))
    puts "#{u.email} #{u.type}"'
  ```
- [ ] En `https://chatwoot.loopchat.com.ar/app/login` → *¿Olvidaste tu contraseña?* → mail recibido (prueba del SMTP de
  Chatwoot) → contraseña nueva → entrar a `/super_admin`.

## 4. Cierre

- [ ] `$PSQL -At < scripts/migration/loopchat-counts.sql > /tmp/despues.txt && diff /tmp/antes.txt /tmp/despues.txt`
  → todo idéntico: `user` y `platform_admins` quedan igual porque entra el superadmin real y sale el de demo.
- [ ] Recién después: borrar las empresas DEMO (paso F de `docs/migracion-vps.md`).
