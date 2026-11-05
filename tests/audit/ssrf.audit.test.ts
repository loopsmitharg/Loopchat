// HARNESS DE AUDITORÍA — guard SSRF de URLs configurables por la empresa (base URL de IA).
// Registra qué hosts internos acepta el guard en modo producción. Uso: npx vitest run -c tests/audit/vitest.audit.config.mts
import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl } from "@/server/http/ssrf";

describe("ssrf (modo producción)", () => {
  it("hosts internos", async () => {
    const env = process.env as Record<string, string>;
    const prev = { n: env.NODE_ENV, a: env.LOOPCHAT_ALLOW_PRIVATE_URLS };
    env.NODE_ENV = "production";
    env.LOOPCHAT_ALLOW_PRIVATE_URLS = "false";
    const accepted = (u: string) => { try { assertSafeOutboundUrl(u, { purpose: "ai" }); return true; } catch { return false; } };
    const blockedOk = ["https://127.0.0.1/", "https://10.0.0.5/", "https://169.254.169.254/", "https://[::1]/", "https://localhost/"].map((u) => [u, accepted(u)]);
    const bypass = ["https://[::ffff:127.0.0.1]/", "https://[::ffff:169.254.169.254]/", "https://[::ffff:a9fe:a9fe]/", "https://127.1/", "https://2130706433/", "https://0x7f000001/", "https://127.0.0.1.nip.io/"].map((u) => [u, accepted(u)]);
    env.NODE_ENV = prev.n;
    env.LOOPCHAT_ALLOW_PRIVATE_URLS = prev.a;
    (await import("node:fs")).writeFileSync("docs/readiness-remediation/evidence/ssrf-results.json", JSON.stringify({ blockedOk, bypass }, null, 2));
    expect(blockedOk.every(([, a]) => a === false)).toBe(true);
    expect(bypass.filter(([u]) => !String(u).includes("nip.io")).every(([, a]) => a === false)).toBe(true);
  });
});
