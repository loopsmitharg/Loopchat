import "dotenv/config";
import { Client } from "pg";

/**
 * SOLO demo local: vacía la base de desarrollo para que coincida con los simuladores
 * (que guardan su estado en memoria y arrancan vacíos). Se niega a correr contra
 * cualquier base que no sea loopchat_dev en localhost.
 */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("demo:reset no se ejecuta en producción");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/loopchat_dev") {
    throw new Error(`demo:reset solo borra loopchat_dev en localhost (DATABASE_URL apunta a ${url.hostname}${url.pathname})`);
  }
  if (!process.env.CHATWOOT_BASE_URL?.includes("localhost")) throw new Error("CHATWOOT_BASE_URL debe apuntar al simulador local");
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query("set client_min_messages to warning; drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  } finally {
    await c.end();
  }
  // vacía también el simulador (si está corriendo) para que ambos queden iguales
  try {
    await fetch(`${process.env.CHATWOOT_BASE_URL}/__sim/reset`, { method: "POST" });
  } catch {
    /* simulador apagado: se vacía al no tener estado */
  }
  console.log("Base DEMO loopchat_dev vaciada.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
