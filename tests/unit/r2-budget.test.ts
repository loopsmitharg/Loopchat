import { describe, expect, it } from "vitest";
import { classifyOps, decide, DEFAULT_BUDGET, encryptedSize, type BudgetInput } from "@/server/ops/r2-budget";

const now = new Date("2026-11-25T03:30:00Z");
const MB = 1e6;
/** Un backup completo de `mb` MB, `daysAgo` días antes de `now`, en la carpeta prod/. */
function set(daysAgo: number, mb: number, parts = ["tar.enc", "key.enc", "sha256"]) {
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  const stamp = d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return parts.map((p) => ({ Path: `prod/loopchat-${stamp}.${p}`, Size: p === "tar.enc" ? mb * MB : 1000 }));
}
const base = (over: Partial<BudgetInput>): BudgetInput => ({ objects: [], prefix: "prod", incomingBytes: 50 * MB, otherBucketsBytes: 0, classA: 0, classB: 0, now, cfg: DEFAULT_BUDGET, ...over });

describe("presupuesto R2", () => {
  it("borra solo las vencidas y sube si entra", () => {
    const objects = [...set(1, 50), ...set(6, 50), ...set(8, 50), ...set(10, 50)];
    const d = decide(base({ objects }));
    expect(d.upload).toBe(true);
    expect(d.deletePaths).toHaveLength(6);
    expect(d.deletePaths.every((p) => objects.slice(6).some((o) => o.Path === p))).toBe(true);
    expect(d.warnings).toEqual([]);
  });

  it("nunca borra la última copia completa aunque esté vencida", () => {
    const keep = set(20, 50);
    const d = decide(base({ objects: [...keep, ...set(30, 50), ...set(2, 50, ["tar.enc"])] }));
    expect(d.deletePaths.some((p) => keep.some((o) => o.Path === p))).toBe(false);
    expect(d.deletePaths).toHaveLength(4); // la vieja de 30 días + la incompleta
  });

  it("sin espacio no sube ni borra copias válidas", () => {
    const objects = [...set(1, 3000), ...set(2, 3000)];
    const d = decide(base({ objects, incomingBytes: 2500 * MB }));
    expect(d.upload).toBe(false);
    expect(d.reason).toMatch(/sin espacio/);
    expect(d.deletePaths).toEqual([]);
  });

  it("cuenta los otros buckets de la cuenta y avisa desde 6 GB", () => {
    const d = decide(base({ objects: set(1, 100), otherBucketsBytes: 5.9e9, incomingBytes: 100 * MB }));
    expect(d.upload).toBe(true);
    expect(d.warnings.join()).toMatch(/almacenamiento R2 en 6\.10 GB/);
    expect(decide(base({ objects: set(1, 100), otherBucketsBytes: 7.9e9, incomingBytes: 100 * MB })).upload).toBe(false);
  });

  it("proyecta la retención y sugiere cuántos días entran", () => {
    const d = decide(base({ objects: set(1, 1000), incomingBytes: 1000 * MB }));
    expect(d.warnings.join()).toMatch(/se proyectan 8\.00 GB; entran 4 días/);
  });

  it("operaciones: avisa al 80 % y bloquea al 95 %", () => {
    expect(decide(base({ classA: 850_000 })).warnings.join()).toMatch(/Clase A del mes al 85 %/);
    const d = decide(base({ classB: 9_600_000 }));
    expect(d.upload).toBe(false);
    expect(d.reason).toMatch(/Clase B del mes al 96 %/);
  });

  it("ignora otras carpetas y archivos ajenos pero los cuenta en el tamaño", () => {
    const d = decide(base({ objects: [...set(30, 50).map((o) => ({ ...o, Path: o.Path.replace("prod/", "otro/") })), { Path: "prod/notas.txt", Size: 10 }] }));
    expect(d.deletePaths).toEqual([]);
    expect(d.summary).toMatch(/0 copias completas/);
  });

  it("clasifica operaciones según la tabla de Cloudflare", () => {
    expect(classifyOps([{ actionType: "PutObject", requests: 3 }, { actionType: "ListObjects", requests: 2 }, { actionType: "GetObject", requests: 5 }, { actionType: "DeleteObject", requests: 9 }, { actionType: "Desconocida", requests: 1 }])).toEqual({ classA: 6, classB: 5 });
  });
});

describe("adjuntos de Chatwoot (incremental)", () => {
  const K = 384;
  const media = (local: { path: string; size: number }[], orphans: Record<string, string> = {}) => ({ local, keyBytes: K, orphans });
  const remote = (path: string, plain: number) => ({ Path: `prod/media/${path}.enc`, Size: encryptedSize(plain, K) });

  it("calcula el tamaño cifrado exacto (PKCS#7 siempre agrega relleno)", () => {
    expect(encryptedSize(0, K)).toBe(K + 16);
    expect(encryptedSize(15, K)).toBe(K + 16);
    expect(encryptedSize(16, K)).toBe(K + 32);
  });

  it("sube solo lo que falta o quedó incompleto, una sola vez", () => {
    const local = [{ path: "ab/cd/abcd1", size: 1000 }, { path: "ab/cd/abcd2", size: 2000 }, { path: "ef/gh/efgh3", size: 3000 }];
    const objects = [remote("ab/cd/abcd1", 1000), { Path: "prod/media/ab/cd/abcd2.enc", Size: 10 }];
    const d = decide(base({ objects, media: media(local) }));
    expect(d.upload).toBe(true);
    expect(d.mediaUpload).toEqual(["ab/cd/abcd2", "ef/gh/efgh3"]);
    expect(decide(base({ objects: [...objects.slice(0, 1), remote("ab/cd/abcd2", 2000), remote("ef/gh/efgh3", 3000)], media: media(local) })).mediaUpload).toEqual([]);
  });

  it("conserva el adjunto borrado localmente durante la retención y después lo borra", () => {
    const objects = [remote("ab/cd/gone", 500)];
    const first = decide(base({ objects, media: media([]) }));
    expect(first.deletePaths).toEqual([]);
    expect(first.orphans).toEqual({ "ab/cd/gone": now.toISOString() });
    const later = decide(base({ objects, media: media([], { "ab/cd/gone": new Date(now.getTime() - 8 * 86_400_000).toISOString() }) }));
    expect(later.deletePaths).toEqual(["prod/media/ab/cd/gone.enc"]);
    expect(later.orphans).toEqual({});
  });

  it("los adjuntos entran en el tope de 8 GB y cuentan una sola vez en la proyección", () => {
    const big = [{ path: "aa/bb/big", size: 7.95e9 }];
    const d = decide(base({ objects: set(1, 50), media: media(big) }));
    expect(d.upload).toBe(false);
    expect(d.reason).toMatch(/sin espacio/);
    const ok = decide(base({ objects: set(1, 50), media: media([{ path: "aa/bb/mid", size: 3e9 }]) }));
    expect(ok.upload).toBe(true);
    expect(ok.summary).toMatch(/proyección 3\.4\d GB/); // 3 GB de adjuntos + 8 × 50 MB, no 8 × 3 GB
  });

  it("no confunde adjuntos con paquetes de base", () => {
    const d = decide(base({ objects: [...set(1, 50), remote("lo/op/loopchat-20261101T000000Z", 10)], media: media([{ path: "lo/op/loopchat-20261101T000000Z", size: 10 }]) }));
    expect(d.deletePaths).toEqual([]);
    expect(d.summary).toMatch(/1 copias completas/);
  });
});
