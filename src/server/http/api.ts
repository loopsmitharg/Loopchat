import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Permission } from "@/lib/permissions";
import {
  assertCan,
  type Ctx,
  isPlatformAdmin,
  requireUser,
  resolveTenantCtx,
  type SessionUser,
  TENANT_COOKIE,
} from "../authz/context";
import { log } from "../log";
import { AppError, badRequest, forbidden } from "./errors";
import { rateLimit } from "./rate-limit";

type RouteParams = { params: Promise<Record<string, string>> };

function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Defensa CSRF: toda mutación debe venir del mismo origen que la app. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  const self = req.nextUrl.origin;
  if (!origin || (origin !== allowed && origin !== self)) throw forbidden("Origen no permitido.");
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Datos inválidos.", details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } },
      { status: 400 },
    );
  }
  log.error("api.unhandled", { err });
  return NextResponse.json({ error: { code: "internal_error", message: "Error interno. Probá de nuevo." } }, { status: 500 });
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 256 * 1024) throw badRequest("Cuerpo demasiado grande.");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("JSON inválido.");
  }
  return schema.parse(raw);
}

type TenantHandler = (args: { req: NextRequest; ctx: Ctx; user: SessionUser; params: Record<string, string> }) => Promise<unknown>;

export function tenantRoute(handler: TenantHandler, opts: { permission?: Permission; rateLimit?: { max: number; window?: number } } = {}) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      assertSameOrigin(req);
      const user = await requireUser(req.headers);
      const resolved = await resolveTenantCtx(user, req.cookies.get(TENANT_COOKIE)?.value, clientIp(req));
      if (!resolved) throw forbidden("Tu usuario no pertenece a ninguna empresa activa.");
      const { ctx } = resolved;
      if (opts.permission) assertCan(ctx, opts.permission);
      if (opts.rateLimit) await rateLimit(`u:${user.id}:${req.nextUrl.pathname}`, opts.rateLimit.max, opts.rateLimit.window);
      const params = (await route?.params) ?? {};
      const result = await handler({ req, ctx, user, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

type PlatformHandler = (args: { req: NextRequest; user: SessionUser; params: Record<string, string>; ip: string | null }) => Promise<unknown>;

export function platformRoute(handler: PlatformHandler) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      assertSameOrigin(req);
      const user = await requireUser(req.headers);
      if (!(await isPlatformAdmin(user.id))) throw forbidden();
      const params = (await route?.params) ?? {};
      const result = await handler({ req, user, params, ip: clientIp(req) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

type PublicHandler = (args: { req: NextRequest; params: Record<string, string>; ip: string | null }) => Promise<unknown>;

export function publicRoute(handler: PublicHandler, opts: { sameOrigin?: boolean; rateLimit?: { max: number; window?: number } } = {}) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      if (opts.sameOrigin !== false) assertSameOrigin(req);
      const ip = clientIp(req);
      if (opts.rateLimit) await rateLimit(`ip:${ip ?? "unknown"}:${req.nextUrl.pathname}`, opts.rateLimit.max, opts.rateLimit.window);
      const params = (await route?.params) ?? {};
      const result = await handler({ req, params, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
