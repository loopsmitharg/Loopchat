import { Client } from "pg";

/** Recrea el esquema de una base de pruebas (sin depender de psql en el PATH; funciona en Windows). */
export async function resetDatabase(url: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("set client_min_messages to warning; drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  } finally {
    await c.end();
  }
}
