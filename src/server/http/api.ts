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
import { AppError, badRequest, forbidden, tooLarge } from "./errors";
import { getIP } from "better-auth/api";
import { assertOperational } from "../services/usage";
import { rateLimit, trustedProxies } from "./rate-limit";

type RouteParams = { params: Promise<Record<string, string>> };

/**
 * IP del cliente con la misma política que Better Auth: X-Forwarded-For se recorre desde la derecha
 * saltando los proxies de confianza (TRUSTED_PROXIES); sin proxies configurados solo se acepta un
 * único valor. Un cliente no puede elegir su propia IP agregando entradas al encabezado.
 */
export function clientIp(req: Request): string | null {
  return getIP(req, { advanced: { ipAddress: { trustedProxies: trustedProxies() } } } as never);
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

/**
 * Lee el cuerpo con un tope real: rechaza por Content-Length declarado y corta el stream apenas
 * se supera el límite (cubre Transfer-Encoding: chunked). Nunca bufferiza más de `max` bytes.
 */
export async function readBodyLimited(req: Request, max: number): Promise<Buffer> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) throw tooLarge();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** multipart/form-data con tope de tamaño (el parseo ocurre sobre el buffer ya acotado). */
export async function readFormLimited(req: Request, max: number): Promise<FormData> {
  const buf = await readBodyLimited(req, max);
  try {
    return await new Response(new Uint8Array(buf), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw badRequest("Formulario inválido.");
  }
}

export const MAX_JSON_BYTES = 256 * 1024;

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const buf = await readBodyLimited(req, MAX_JSON_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString("utf8"));
  } catch {
    throw badRequest("JSON inválido.");
  }
  return schema.parse(raw);
}

type TenantHandler = (args: { req: NextRequest; ctx: Ctx; user: SessionUser; params: Record<string, string> }) => Promise<unknown>;

/**
 * Política de suspensión (única para toda la API de empresa): con la empresa suspendida o la
 * suscripción cancelada solo se permite leer y las acciones de resguardo marcadas con
 * `allowWhenSuspended` (revocar credenciales, desconectar el número, deshabilitar usuarios,
 * revocar invitaciones). Bots y envíos además se frenan en el motor (isOperational).
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function tenantRoute(handler: TenantHandler, opts: { permission?: Permission; rateLimit?: { max: number; window?: number }; allowWhenSuspended?: boolean } = {}) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      assertSameOrigin(req);
      const user = await requireUser(req.headers);
      const resolved = await resolveTenantCtx(user, req.cookies.get(TENANT_COOKIE)?.value, clientIp(req));
      if (!resolved) throw forbidden("Tu usuario no pertenece a ninguna empresa activa.");
      const { ctx } = resolved;
      if (opts.permission) assertCan(ctx, opts.permission);
      if (!READ_METHODS.has(req.method) && !opts.allowWhenSuspended) await assertOperational(ctx.tenantId);
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
