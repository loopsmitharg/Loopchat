import { NextResponse } from "next/server";
import { z } from "zod";
import { listMemberships, requireUser, TENANT_COOKIE } from "@/server/authz/context";
import { errorResponse, readJson } from "@/server/http/api";
import { notFound } from "@/server/http/errors";
import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin !== new URL(process.env.APP_URL ?? "http://localhost:3000").origin && origin !== req.nextUrl.origin) {
      return NextResponse.json({ error: { code: "forbidden", message: "Origen no permitido." } }, { status: 403 });
    }
    const user = await requireUser(req.headers);
    const { tenantId } = await readJson(req, z.object({ tenantId: z.string().uuid() }));
    const list = await listMemberships(user.id);
    if (!list.some((m) => m.tenantId === tenantId)) throw notFound();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 180 });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
