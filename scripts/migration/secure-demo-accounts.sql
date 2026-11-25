-- Antes de publicar el VPS: anula el acceso de las cuentas de demo (contraseña pública del seed, seed-demo.ts).
-- No borra datos: los usuarios, sus membresías y su autoría quedan; solo se elimina la credencial de contraseña y las
-- sesiones, así que nadie puede entrar con ellas (ni por "olvidé mi contraseña": los emails .test no reciben correo).
-- Las empresas DEMO se borran después, con calma (docs/migracion-vps.md § F).
-- Uso: $LC exec -T db psql -U loopchat -d loopchat -v ON_ERROR_STOP=1 < scripts/migration/secure-demo-accounts.sql
begin;
delete from session where user_id in (select id from "user" where email like '%@demo.loopchat.test' or email like '%.demo.loopchat.test');
delete from account where provider_id = 'credential'
  and user_id in (select id from "user" where email like '%@demo.loopchat.test' or email like '%.demo.loopchat.test');
-- comprobación: ninguna cuenta de demo puede iniciar sesión con contraseña
select count(*) as demo_con_contrasena from account a join "user" u on u.id = a.user_id
 where a.provider_id = 'credential' and (u.email like '%@demo.loopchat.test' or u.email like '%.demo.loopchat.test');
commit;
