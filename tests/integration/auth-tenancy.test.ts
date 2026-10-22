import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { devMailOutbox, memberships } from "@/server/db/schema";
import { getAuth } from "@/server/auth";
import { getSessionUser, resolveTenantCtx } from "@/server/authz/context";
import { acceptInvitation, createInvitation, describeInvitation } from "@/server/services/invitations";
import { listMembers, updateMember } from "@/server/services/members";
import { addMember, ctxFor, makePlatformAdmin, makeTenant, makeUser, twoTenants } from "../helpers/factory";

async function signIn(email: string, password: string) {
  const res = await getAuth().api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, cookie };
}

describe("autenticación", () => {
  it("login correcto crea sesión válida; password incorrecto falla; logout invalida", async () => {
    const u = await makeUser("Laura Login");
    const bad = await signIn(u.email, "incorrecta-123456").catch((e) => ({ status: e.statusCode ?? 401, cookie: "" }));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await signIn(u.email, u.password);
    expect(ok.status).toBe(200);
    const h = new Headers({ cookie: ok.cookie });
    expect((await getSessionUser(h))?.email).toBe(u.email);
    await getAuth().api.signOut({ headers: h });
    expect(await getSessionUser(h)).toBeNull();
  });

  it("registro público deshabilitado (solo por invitación)", async () => {
    await expect(
      getAuth().api.signUpEmail({ body: { email: "nuevo@test.local", password: "contraseña-larga-1", name: "X" } }),
    ).rejects.toThrow();
  });

  it("reset de contraseña: envía email con enlace, cambia la clave y revoca sesiones", async () => {
    const u = await makeUser("Rita Reset");
    const s = await signIn(u.email, u.password);
    await getAuth().api.requestPasswordReset({ body: { email: u.email, redirectTo: "/restablecer/nueva" } });
    const [mail] = await db.select().from(devMailOutbox).where(eq(devMailOutbox.to, u.email)).orderBy(desc(devMailOutbox.createdAt)).limit(1);
    expect(mail.subject).toMatch(/Restablecer/);
    const token = mail.body.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();
    await getAuth().api.resetPassword({ body: { token: token!, newPassword: "nueva-contraseña-99" } });
    expect(await getSessionUser(new Headers({ cookie: s.cookie }))).toBeNull();
    expect((await signIn(u.email, "nueva-contraseña-99")).status).toBe(200);
  });
});

describe("invitaciones y membresías", () => {
  it("platform admin crea empresa → invitación de admin → aceptación crea usuario y membresía", async () => {
    await makePlatformAdmin();
    const t = await makeTenant("starter", "Ferretería Demo");
    const inv = await createInvitation({ tenantId: t.id, actor: { kind: "system" } }, { email: "duena@ferreteria.test", role: "tenant_admin" });
    const token = inv.url.split("/").pop()!;
    const info = await describeInvitation(token);
    expect(info.tenantName).toBe("Ferretería Demo");
    const res = await acceptInvitation({ token, name: "Dueña", password: "una-clave-larga-1" }, null);
    expect(res.createdUser).toBe(true);
    await expect(acceptInvitation({ token, name: "Otra", password: "una-clave-larga-1" }, null)).rejects.toThrow(/inválida|vencida/);
    const ok = await signIn("duena@ferreteria.test", "una-clave-larga-1");
    expect(ok.status).toBe(200);
  });

  it("tenant_admin invita agente; un agent no puede invitar", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const inv = await createInvitation({ tenantId: A.id, actor: { kind: "tenant", ctx: ctxA } }, { email: `ag-${Date.now()}@test.local`, role: "agent" });
    expect(inv.role).toBe("agent");
    await expect(createInvitation({ tenantId: A.id, actor: { kind: "tenant", ctx: ctxAgentA } }, { email: "x@test.local", role: "agent" })).rejects.toThrow(/permiso/);
  });

  it("admin de A no puede invitar dentro de B cambiando el tenantId", async () => {
    const { B, ctxA } = await twoTenants();
    await expect(createInvitation({ tenantId: B.id, actor: { kind: "tenant", ctx: ctxA } }, { email: "intruso@test.local", role: "agent" })).rejects.toThrow(/No encontrado/);
  });

  it("límite de agentes del plan bloquea nuevas invitaciones", async () => {
    const t = await makeTenant("starter"); // 3 agentes
    const admin = await addMember(t.id, "tenant_admin");
    await addMember(t.id, "agent");
    await addMember(t.id, "agent");
    const ctx = ctxFor(t.id, admin, "tenant_admin");
    await expect(createInvitation({ tenantId: t.id, actor: { kind: "tenant", ctx } }, { email: "cuarto@test.local", role: "agent" })).rejects.toThrow(/máximo de usuarios/);
  });
});

describe("resolución de tenant", () => {
  it("la cookie de tenant se valida contra membresías: no se puede elegir una empresa ajena", async () => {
    const { A, B, adminA } = await twoTenants();
    const r = await resolveTenantCtx({ id: adminA.id, name: adminA.name, email: adminA.email }, B.id);
    expect(r?.ctx.tenantId).toBe(A.id);
  });

  it("usuario deshabilitado pierde acceso y no se puede deshabilitar el último admin", async () => {
    const { A, ctxA, adminA, agentA } = await twoTenants();
    const members = await listMembers(ctxA);
    const agentMembership = members.find((m) => m.userId === agentA.id)!;
    await updateMember(ctxA, agentMembership.membershipId, { status: "disabled" });
    expect(await resolveTenantCtx({ id: agentA.id, name: "", email: agentA.email }, A.id)).toBeNull();
    const adminMembership = await db.query.memberships.findFirst({ where: and(eq(memberships.tenantId, A.id), eq(memberships.userId, adminA.id)) });
    await expect(updateMember(ctxA, adminMembership!.id, { status: "disabled" })).rejects.toThrow(/propio|administrador/);
  });

  it("admin de B no puede modificar membresías de A", async () => {
    const { ctxA, ctxB, agentA } = await twoTenants();
    const m = (await listMembers(ctxA)).find((x) => x.userId === agentA.id)!;
    await expect(updateMember(ctxB, m.membershipId, { role: "viewer" })).rejects.toThrow(/No encontrado/);
  });
});
