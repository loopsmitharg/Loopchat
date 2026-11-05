import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { makeUser } from "../helpers/factory";

// Límites de autenticación activos en este archivo (en producción lo están siempre).
process.env.AUTH_RATE_LIMIT = "true";
process.env.TRUSTED_PROXIES = "10.0.0.0/8";

const g = globalThis as unknown as { __loopchatAuth?: unknown };
/** Simula otra instancia de la app (o un reinicio): nueva instancia de Better Auth, sin memoria compartida. */
const freshInstance = () => {
  delete g.__loopchatAuth;
  return getAuth();
};

async function signIn(email: string, xff: string) {
  const res = await getAuth().handler(
    new Request(`${process.env.APP_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: process.env.APP_URL!, "x-forwarded-for": xff },
      body: JSON.stringify({ email, password: "incorrecta-123456" }),
    }),
  );
  return res.status;
}

/** Evita cruzar el borde de una ventana de 60 s en medio de la prueba. */
async function awayFromWindowEdge() {
  const s = new Date().getSeconds();
  if (s > 50) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
}

beforeEach(async () => {
  await db.execute(sql`delete from rate_limits`);
  freshInstance();
});

describe("rate limiting de autenticación (regresión SEC-06)", () => {
  it("por IP: el 9.º intento en un minuto recibe 429 aunque el cliente agregue IPs falsas a X-Forwarded-For", async () => {
    await awayFromWindowEdge();
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push(await signIn(`nadie${i}@test.local`, `198.51.100.${i}, 203.0.113.7, 10.0.0.2`));
    expect(codes.slice(0, 8).every((c) => c === 401)).toBe(true);
    expect(codes[8]).toBe(429);
  });

  it("los límites persisten entre instancias/reinicios (almacenamiento compartido)", async () => {
    await awayFromWindowEdge();
    for (let i = 0; i < 4; i++) expect(await signIn(`a${i}@test.local`, "203.0.113.9, 10.0.0.2")).toBe(401);
    freshInstance();
    for (let i = 0; i < 4; i++) expect(await signIn(`b${i}@test.local`, "203.0.113.9, 10.0.0.2")).toBe(401);
    freshInstance();
    expect(await signIn("c@test.local", "203.0.113.9, 10.0.0.2")).toBe(429);
  });

  it("por cuenta: 11 intentos contra el mismo email desde 11 IPs distintas → 429", async () => {
    const u = await makeUser();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push(await signIn(u.email, `203.0.113.${100 + i}, 10.0.0.2`));
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
