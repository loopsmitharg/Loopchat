import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, needsReencryption, secretHint } from "@/server/crypto/vault";

describe("vault", () => {
  it("cifra y descifra con la clave activa", () => {
    const enc = encryptSecret("sk-super-secreto-123", "tenant-1");
    expect(enc).not.toContain("super-secreto");
    expect(enc.startsWith("lc1:t2:")).toBe(true);
    expect(decryptSecret(enc, "tenant-1")).toBe("sk-super-secreto-123");
  });
  it("AAD distinto (otro tenant) falla", () => {
    const enc = encryptSecret("x", "tenant-1");
    expect(() => decryptSecret(enc, "tenant-2")).toThrow();
  });
  it("descifra secretos de una clave anterior y detecta rotación pendiente", () => {
    const prev = process.env.LOOPCHAT_ENCRYPTION_KEYS!;
    const oldOnly = prev.split(",")[1];
    process.env.LOOPCHAT_ENCRYPTION_KEYS = oldOnly;
    const enc = encryptSecret("viejo");
    process.env.LOOPCHAT_ENCRYPTION_KEYS = prev;
    expect(decryptSecret(enc)).toBe("viejo");
    expect(needsReencryption(enc)).toBe(true);
  });
  it("hint nunca expone el valor completo", () => {
    expect(secretHint("EAAG1234567890abcd")).toBe("••••abcd");
    expect(secretHint("short")).toBe("••••");
  });
});
