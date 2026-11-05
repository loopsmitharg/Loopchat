import "server-only";
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { badRequest } from "./errors";

/** Destinos no ruteables públicamente (privados, loopback, link-local, reservados, multicast). */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, bits, "ipv6");

/** IPv4 embebida en IPv6 (mapeada ::ffff:, compatible ::, NAT64 64:ff9b::/96, 6to4 2002::/16). */
function embeddedV4(ip6: string): string | null {
  const groups = expandV6(ip6);
  if (!groups) return null;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zeros = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (zeros(5) && groups[5] === 0xffff) return v4(groups[6], groups[7]);
  if (zeros(6)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]);
  return null;
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(fill).fill("0"), ...t];
  if (all.length !== 8) return null;
  const nums = all.map((g) => parseInt(g, 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

/** true si la IP (literal) no es un destino público aceptable. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v === 6) {
    const v4 = embeddedV4(ip);
    if (v4 && blocked.check(v4, "ipv4")) return true;
    return blocked.check(ip, "ipv6");
  }
  return true;
}

function isPrivateName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".home.arpa");
}

export const allowPrivateUrls = () => process.env.LOOPCHAT_ALLOW_PRIVATE_URLS === "true" && process.env.NODE_ENV !== "production";

/**
 * Protección SSRF para URLs configurables (base URL de proveedores IA compatibles).
 * Validación del texto de la URL: protocolo, credenciales, IP literal y nombres internos.
 * La resolución DNS se valida en el momento de conectar (`safeLookup`), no acá.
 * `chatwoot` es configuración del operador (env), por eso permite red privada (p.ej. Docker).
 */
export function assertSafeOutboundUrl(raw: string, opts: { purpose: "ai" | "chatwoot" | "meta" }) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest("URL inválida.");
  }
  if (u.username || u.password) throw badRequest("La URL no puede incluir credenciales.");
  if (opts.purpose === "chatwoot") {
    if (!["http:", "https:"].includes(u.protocol)) throw badRequest("Protocolo no permitido.");
    return u;
  }
  const allowPrivate = allowPrivateUrls();
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) throw badRequest("La URL debe usar https.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!allowPrivate && (isPrivateName(host) || (isIP(host) && isBlockedIp(host)))) throw badRequest("La URL apunta a una red privada y no está permitida.");
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` para http(s).request: resuelve y rechaza si CUALQUIER dirección resultante es privada.
 * Se ejecuta en la conexión real, así que la IP validada es la IP usada (sin DNS rebinding).
 */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb) {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (!list.length || bad) {
      const e = new Error("SSRF_BLOCKED") as NodeJS.ErrnoException;
      e.code = "SSRF_BLOCKED";
      return cb(e, []);
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
