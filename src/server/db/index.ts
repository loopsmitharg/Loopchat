import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __loopchatPool?: Pool; __loopchatDb?: DB };

export function getPool(): Pool {
  if (!globalForDb.__loopchatPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no configurado");
    globalForDb.__loopchatPool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return globalForDb.__loopchatPool;
}

export function getDb(): DB {
  if (!globalForDb.__loopchatDb) {
    globalForDb.__loopchatDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__loopchatDb;
}

export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
