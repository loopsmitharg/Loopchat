import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de secretos en reposo (AES-256-GCM) con versión de clave para rotación.
 * Formato: `lc1:<keyId>:<iv b64url>:<tag b64url>:<ciphertext b64url>`.
 * Las claves vienen de LOOPCHAT_ENCRYPTION_KEYS = "k2:<base64 32 bytes>,k1:<base64 32 bytes>"
 * (la primera es la activa para cifrar; las demás solo se usan para descifrar).
 */
type Key = { id: string; key: Buffer };

function loadKeys(): Key[] {
  const raw = process.env.LOOPCHAT_ENCRYPTION_KEYS;
  if (!raw) throw new Error("LOOPCHAT_ENCRYPTION_KEYS no configurado");
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx < 1) throw new Error("Formato de LOOPCHAT_ENCRYPTION_KEYS inválido (id:base64)");
      const id = entry.slice(0, idx);
      const key = Buffer.from(entry.slice(idx + 1), "base64");
      if (key.length !== 32) throw new Error(`La clave ${id} debe tener 32 bytes en base64`);
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Id de clave inválido");
      return { id, key };
    });
  if (keys.length === 0) throw new Error("No hay claves de cifrado");
  return keys;
}

export function encryptSecret(plain: string, aad?: string): string {
  const [active] = loadKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", active.key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["lc1", active.id, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(payload: string, aad?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "lc1") throw new Error("Secreto cifrado con formato desconocido");
  const [, keyId, ivB, tagB, ctB] = parts;
  const key = loadKeys().find((k) => k.id === keyId);
  if (!key) throw new Error(`Clave de cifrado ${keyId} no disponible`);
  const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(ivB, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** Reporta si un secreto fue cifrado con una clave distinta a la activa (necesita re-cifrado). */
export function needsReencryption(payload: string): boolean {
  const [active] = loadKeys();
  return payload.split(":")[1] !== active.id;
}

export function secretHint(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return "••••";
  return `••••${s.slice(-4)}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
