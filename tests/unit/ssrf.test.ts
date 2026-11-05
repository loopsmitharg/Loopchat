import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSafeOutboundUrl, isBlockedIp, safeLookup } from "@/server/http/ssrf";
import { postJson } from "@/server/ai/http";

const env = process.env as Record<string, string>;
let prev: { n: string; a: string };
beforeEach(() => {
  prev = { n: env.NODE_ENV, a: env.LOOPCHAT_ALLOW_PRIVATE_URLS };
  env.NODE_ENV = "production";
  env.LOOPCHAT_ALLOW_PRIVATE_URLS = "false";
});
afterEach(() => {
  env.NODE_ENV = prev.n;
  env.LOOPCHAT_ALLOW_PRIVATE_URLS = prev.a;
});
const accepted = (u: string) => {
  try {
    assertSafeOutboundUrl(u, { purpose: "ai" });
    return true;
  } catch {
    return false;
  }
};

describe("SSRF: validación de IPs (regresión auditoría SEC-02)", () => {
  it("rechaza IPv4 privadas/reservadas y sus formas embebidas en IPv6", () => {
    for (const u of [
      "https://127.0.0.1/", "https://10.0.0.5/", "https://169.254.169.254/", "https://100.64.1.1/", "https://0.0.0.0/",
      "https://[::1]/", "https://[::]/", "https://[::ffff:127.0.0.1]/", "https://[::ffff:169.254.169.254]/", "https://[::ffff:a9fe:a9fe]/",
      "https://[64:ff9b::a9fe:a9fe]/", "https://[2002:7f00:1::]/", "https://[fd00::1]/", "https://[fe80::1]/", "https://127.1/", "https://2130706433/", "https://0x7f000001/",
      "https://localhost/", "https://db.internal/",
    ])
      expect(accepted(u), u).toBe(false);
  });
  it("acepta destinos públicos", () => {
    for (const u of ["https://api.openai.com/v1", "https://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://[::ffff:8.8.8.8]/"]) expect(accepted(u), u).toBe(true);
  });
  it("isBlockedIp cubre rangos clave", () => {
    expect(isBlockedIp("172.20.1.1")).toBe(true);
    expect(isBlockedIp("172.32.1.1")).toBe(false);
    expect(isBlockedIp("::ffff:10.1.2.3")).toBe(true);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });
});

describe("SSRF: resolución DNS validada en la conexión", () => {
  it("un nombre que resuelve a loopback se bloquea en el lookup", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((r) => safeLookup("localhost", {}, (e) => r(e)));
    expect(err?.code).toBe("SSRF_BLOCKED");
  });
  it("postJson no conecta a un servicio interno aunque la URL pase el filtro de texto ('localhost.' con punto final)", async () => {
    let hits = 0;
    const srv = createServer((_q, s) => {
      hits++;
      s.end("{}");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    await expect(postJson(`https://localhost.:${port}/v1/chat/completions`, {}, {}, 2000)).rejects.toThrow(/red privada/);
    expect(hits).toBe(0);
    srv.close();
  });
  it("no sigue redirecciones", async () => {
    env.NODE_ENV = "test";
    env.LOOPCHAT_ALLOW_PRIVATE_URLS = "true";
    const srv = createServer((_q, s) => {
      s.writeHead(302, { location: "http://169.254.169.254/" });
      s.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    await expect(postJson(`http://127.0.0.1:${port}/x`, {}, {}, 2000)).rejects.toThrow(/redirección/);
    srv.close();
  });
});
