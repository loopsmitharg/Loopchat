import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tooMany } from "./errors";

/**
 * Rate limit de ventana fija persistido en Postgres (sirve con varias instancias).
 * Lanza AppError 429 si se supera el máximo.
 */
export async function rateLimit(key: string, max: number, windowSeconds = 60) {
  if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") return;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(res.rows[0]?.count ?? 0);
  if (count > max) throw tooMany();
}
