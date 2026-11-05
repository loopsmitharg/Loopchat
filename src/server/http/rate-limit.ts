import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tooMany } from "./errors";

/**
 * Ventana fija persistida en Postgres: compartida entre instancias y sobrevive reinicios.
 * Devuelve si se permite y cuántos segundos faltan para la próxima ventana.
 */
export async function consumeRateLimit(key: string, max: number, windowSeconds = 60): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / windowSeconds) * windowSeconds;
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(res.rows[0]?.count ?? 0);
  return count > max ? { allowed: false, retryAfter: windowStart + windowSeconds - nowSec } : { allowed: true, retryAfter: null };
}

/** Lanza AppError 429 si se supera el máximo. */
export async function rateLimit(key: string, max: number, windowSeconds = 60) {
  if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") return;
  if (!(await consumeRateLimit(key, max, windowSeconds)).allowed) throw tooMany();
}

/** Proxies de confianza (CIDR) que agregan X-Forwarded-For; sin ellos no se confía en el encabezado. */
export function trustedProxies(): string[] {
  return (process.env.TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
