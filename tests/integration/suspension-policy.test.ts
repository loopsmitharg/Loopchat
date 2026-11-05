import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { tenants } from "@/server/db/schema";
import { getAuth } from "@/server/auth";
import { createAiConnection } from "@/server/services/ai-connections";
import * as bots from "@/app/api/v1/bots/route";
import * as contacts from "@/app/api/v1/contacts/route";
import * as opportunities from "@/app/api/v1/opportunities/route";
import * as aiConns from "@/app/api/v1/ai-connections/route";
import * as aiConn from "@/app/api/v1/ai-connections/[id]/route";
import * as aiProfile from "@/app/api/v1/ai-profile/route";
import * as products from "@/app/api/v1/products/route";
import * as tenantApi from "@/app/api/v1/tenant/route";
import * as member from "@/app/api/v1/members/[id]/route";
import { addMember, ctxFor, makeTenant } from "../helpers/factory";
import { memberships } from "@/server/db/schema";

const APP = process.env.APP_URL!;

async function sessionCookie(email: string, password: string) {
  const res = await getAuth().handler(new Request(`${APP}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: JSON.stringify({ email, password }) }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

type Handler = (req: NextRequest, r: { params: Promise<Record<string, string>> }) => Promise<Response>;
const call = (h: Handler, cookie: string, method: string, path: string, body?: unknown, params: Record<string, string> = {}) =>
  h(new NextRequest(`${APP}${path}`, { method, headers: { cookie, origin: APP, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve(params) });

describe("política central de suspensión (regresión SEC-08 / P1-14)", () => {
  it("empresa suspendida: lectura sí; escrituras comerciales, bots, IA e integraciones no; resguardo sí", async () => {
    const T = await makeTenant("growth", "Empresa Suspendida");
    const admin = await addMember(T.id, "tenant_admin", "Admin S");
    const agent = await addMember(T.id, "agent", "Agente S");
    const conn = await createAiConnection(ctxFor(T.id, admin, "tenant_admin"), { provider: "openai_compatible", label: "Principal", apiKey: "sk-test-key-123456", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, T.id));
    const cookie = await sessionCookie(admin.email, admin.password);

    expect((await call(contacts.GET as Handler, cookie, "GET", "/api/v1/contacts")).status).toBe(200);
    const blocked = await Promise.all([
      call(bots.POST as Handler, cookie, "POST", "/api/v1/bots", { name: "Nuevo", mode: "instructions", instructions: "x", allowedTools: ["classify"], handoffKeywords: [] }),
      call(contacts.POST as Handler, cookie, "POST", "/api/v1/contacts", { name: "Cliente", phone: "+5491122223333" }),
      call(opportunities.POST as Handler, cookie, "POST", "/api/v1/opportunities", { title: "Venta" }),
      call(aiConns.POST as Handler, cookie, "POST", "/api/v1/ai-connections", { provider: "openai_compatible", label: "Segunda", apiKey: "sk-otra-123456789", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" }),
      call(aiProfile.PUT as Handler, cookie, "PUT", "/api/v1/ai-profile", { objective: "vender" }),
      call(products.POST as Handler, cookie, "POST", "/api/v1/products", { title: "P", description: "d" }),
      call(tenantApi.PATCH as Handler, cookie, "PATCH", "/api/v1/tenant", { name: "Otro nombre" }),
    ]);
    for (const r of blocked) expect(r.status).toBe(422);
    expect((await blocked[0].json()).error.details.reason).toBe("subscription_inactive");

    const agentMembership = (await db.query.memberships.findFirst({ where: eq(memberships.userId, agent.id) }))!;
    expect((await call(member.PATCH as Handler, cookie, "PATCH", "/", { role: "manager" }, { id: agentMembership.id })).status).toBe(422);
    expect((await call(member.PATCH as Handler, cookie, "PATCH", "/", { status: "disabled" }, { id: agentMembership.id })).status).toBe(200);
    expect((await call(aiConn.DELETE as Handler, cookie, "DELETE", "/", undefined, { id: conn.id })).status).toBe(200);

    // reactivada: vuelve a operar
    await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, T.id));
    expect((await call(contacts.POST as Handler, cookie, "POST", "/api/v1/contacts", { name: "Cliente", phone: "+5491122223333" })).status).toBe(200);
  });
});
