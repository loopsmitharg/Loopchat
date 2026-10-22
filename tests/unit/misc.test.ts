import { afterEach, describe, expect, it } from "vitest";
import { toE164 } from "@/lib/phone";
import { assertSafeOutboundUrl } from "@/server/http/ssrf";
import { chunkText } from "@/server/services/knowledge";
import { windowState } from "@/server/services/outbound";
import { redact } from "@/server/log";

describe("teléfonos E.164", () => {
  it("normaliza formatos argentinos e internacionales", () => {
    expect(toE164("+54 9 11 2345-6789")).toBe("+5491123456789");
    expect(toE164("5491123456789")).toBe("+5491123456789");
    expect(toE164("+1 415 555 2671")).toBe("+14155552671");
    expect(toE164("123")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("protección SSRF", () => {
  const prev = process.env.LOOPCHAT_ALLOW_PRIVATE_URLS;
  afterEach(() => {
    process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = prev;
  });
  it("en modo estricto exige https y bloquea redes privadas/metadata", () => {
    process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = "false";
    expect(() => assertSafeOutboundUrl("http://api.openai.com/v1", { purpose: "ai" })).toThrow(/https/);
    for (const u of ["https://127.0.0.1/", "https://169.254.169.254/latest", "https://10.1.2.3/", "https://192.168.0.10/", "https://localhost:8080", "https://[::1]/", "https://user:pass@api.example.com/"]) {
      expect(() => assertSafeOutboundUrl(u, { purpose: "ai" }), u).toThrow();
    }
    expect(assertSafeOutboundUrl("https://openrouter.ai/api/v1", { purpose: "ai" }).hostname).toBe("openrouter.ai");
  });
});

describe("ventana de 24 h de WhatsApp", () => {
  it("abierta, cerrada y sin mensajes del contacto", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(windowState(new Date(now - 3600_000), now).open).toBe(true);
    expect(windowState(new Date(now - 25 * 3600_000), now).open).toBe(false);
    expect(windowState(null, now).open).toBe(false);
  });
});

describe("utilidades", () => {
  it("chunking de texto", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Párrafo ${i} ` + "x".repeat(300)).join("\n\n");
    const chunks = chunkText(text, 900);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 900)).toBe(true);
  });
  it("redacción de logs", () => {
    const r = redact({ apiKey: "sk-123", nested: { token: "abc", ok: "Bearer xyz.secret" }, content: "mensaje privado" }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/sk-123|abc|xyz\.secret|mensaje privado/);
  });
});

import { csvCell } from "@/server/services/export";
import { isWithinBusinessHours } from "@/lib/business-hours";

describe("exportación CSV y horario", () => {
  it("escapa comillas/separadores y neutraliza fórmulas", () => {
    expect(csvCell('Juan "el" Pérez')).toBe('"Juan ""el"" Pérez"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+5491112345678")).toBe("'+5491112345678");
    expect(csvCell(null)).toBe("");
  });
  it("horario de atención en la zona de la empresa", () => {
    const h = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    // martes 2026-10-20 15:00 UTC = 12:00 en Buenos Aires
    expect(isWithinBusinessHours(h, "America/Argentina/Buenos_Aires", new Date("2026-10-20T15:00:00Z"))).toBe(true);
    // martes 23:00 UTC = 20:00 en Buenos Aires
    expect(isWithinBusinessHours(h, "America/Argentina/Buenos_Aires", new Date("2026-10-20T23:00:00Z"))).toBe(false);
    // domingo
    expect(isWithinBusinessHours(h, "America/Argentina/Buenos_Aires", new Date("2026-10-18T15:00:00Z"))).toBe(false);
    expect(isWithinBusinessHours({ ...h, enabled: false }, "America/Argentina/Buenos_Aires")).toBe(true);
  });
});
