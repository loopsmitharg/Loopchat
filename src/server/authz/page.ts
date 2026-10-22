import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin, resolveTenantCtx, TENANT_COOKIE } from "./context";

/** Para Server Components: exige sesión y empresa; redirige si falta. */
export async function requirePageContext() {
  const h = await headers();
  const user = await getSessionUser(h);
  if (!user) redirect("/login");
  const c = await cookies();
  const resolved = await resolveTenantCtx(user, c.get(TENANT_COOKIE)?.value, null);
  const platform = await isPlatformAdmin(user.id);
  if (!resolved) {
    if (platform) redirect("/admin");
    redirect("/sin-empresa");
  }
  return { user, ...resolved, isPlatformAdmin: platform };
}

export async function requirePlatformPage() {
  const h = await headers();
  const user = await getSessionUser(h);
  if (!user) redirect("/login?next=/admin");
  if (!(await isPlatformAdmin(user.id))) redirect("/dashboard");
  return { user };
}
