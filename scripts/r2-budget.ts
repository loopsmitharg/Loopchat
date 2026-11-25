import { readFileSync, writeFileSync } from "node:fs";
import { classifyOps, decide, DEFAULT_BUDGET, type RemoteObject } from "../src/server/ops/r2-budget";

/**
 * Lo llama scripts/backup.sh antes de subir a R2. Falla (exit 1) si no puede medir: sin medición no se sube.
 * Uso: r2-budget <listado lsjson> <bytes a subir> <bucket> <prefijo> <archivo de salida con rutas a borrar>
 *        [<adjuntos locales "tamaño\truta"> <bytes de la clave RSA> <estado de huérfanos .json> <salida: adjuntos a subir>]
 * Variables: R2_ACCOUNT_ID, R2_ANALYTICS_TOKEN (permiso "Account Analytics: Read"), BACKUP_REMOTE_RETENTION_DAYS (7),
 *   R2_MAX_BYTES (8e9), R2_WARN_BYTES (6e9), R2_OPS_WARN_PCT (80), R2_OPS_MAX_PCT (95).
 * Imprime líneas UPLOAD=, REASON=, WARN=, SUMMARY= para el script de bash.
 */
const [listing, incoming, bucket, prefix = "", deleteOut, mediaList, keyBytes, orphansFile, mediaOut] = process.argv.slice(2);
const num = (name: string, d: number) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : d);
const GRAPHQL = process.env.R2_GRAPHQL_URL || "https://api.cloudflare.com/client/v4/graphql";

// Métricas de toda la cuenta: operaciones del mes (UTC) y tamaño más reciente por bucket. Tienen demora
// y no son la cifra de facturación; los márgenes (8 de 10 GB, 95 % de ops) cubren esa diferencia.
async function accountUsage(now: Date) {
  const account = process.env.R2_ACCOUNT_ID;
  const token = process.env.R2_ANALYTICS_TOKEN;
  if (!account || !token) throw new Error("faltan R2_ACCOUNT_ID / R2_ANALYTICS_TOKEN para medir la cuenta");
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const query = `query ($account: string!, $monthStart: Time!, $storageStart: Time!, $end: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      ops: r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $monthStart, datetime_leq: $end }) { sum { requests } dimensions { actionType } }
      storage: r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $storageStart, datetime_leq: $end }, orderBy: [datetime_DESC]) { max { payloadSize metadataSize } dimensions { bucketName datetime } }
    } } }`;
  const r = await fetch(GRAPHQL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { account, monthStart: monthStart.toISOString(), storageStart: new Date(now.getTime() - 3 * 86_400_000).toISOString(), end: now.toISOString() } }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await r.json().catch(() => null)) as { data?: { viewer?: { accounts?: Acc[] } }; errors?: { message: string }[] } | null;
  const acc = body?.data?.viewer?.accounts?.[0];
  if (!r.ok || body?.errors?.length || !acc) throw new Error(`API de métricas de Cloudflare: HTTP ${r.status} ${body?.errors?.map((e) => e.message).join("; ") ?? ""}`.trim());
  const latest = new Map<string, number>(); // orden datetime DESC: la primera fila de cada bucket es la más reciente
  for (const s of acc.storage) if (!latest.has(s.dimensions.bucketName)) latest.set(s.dimensions.bucketName, s.max.payloadSize + s.max.metadataSize);
  const otherBucketsBytes = [...latest].filter(([name]) => name !== bucket).reduce((n, [, b]) => n + b, 0);
  return { otherBucketsBytes, ...classifyOps(acc.ops.map((o) => ({ actionType: o.dimensions.actionType, requests: o.sum.requests }))) };
}
type Acc = {
  ops: { sum: { requests: number }; dimensions: { actionType: string } }[];
  storage: { max: { payloadSize: number; metadataSize: number }; dimensions: { bucketName: string } }[];
};

function readMedia() {
  if (!(Number(keyBytes) > 0) || !orphansFile || !mediaOut) throw new Error("adjuntos: faltan <bytes de clave> <estado> <salida>");
  const local = readFileSync(mediaList, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const tab = l.indexOf("\t");
      return { size: Number(l.slice(0, tab)), path: l.slice(tab + 1) };
    });
  if (local.some((f) => !(f.size >= 0) || !f.path || f.path.startsWith("/") || f.path.split("/").includes(".."))) throw new Error("adjuntos: listado local inválido");
  let orphans: Record<string, string> = {};
  try {
    orphans = JSON.parse(readFileSync(orphansFile, "utf8"));
  } catch {
    /* primera corrida o estado perdido: los huérfanos vuelven a contar desde hoy (lado seguro) */
  }
  return { local, keyBytes: Number(keyBytes), orphans };
}

async function main() {
  if (!listing || !(Number(incoming) > 0) || !bucket || !deleteOut) throw new Error("uso: r2-budget <lsjson> <bytes> <bucket> <prefijo> <salida>");
  const now = new Date();
  const objects = JSON.parse(readFileSync(listing, "utf8")) as RemoteObject[];
  const usage = await accountUsage(now);
  const media = mediaList ? readMedia() : undefined;
  const d = decide({
    objects,
    prefix,
    incomingBytes: Number(incoming),
    ...usage,
    now,
    media,
    cfg: {
      ...DEFAULT_BUDGET,
      retentionDays: num("BACKUP_REMOTE_RETENTION_DAYS", DEFAULT_BUDGET.retentionDays),
      maxBytes: num("R2_MAX_BYTES", DEFAULT_BUDGET.maxBytes),
      warnBytes: num("R2_WARN_BYTES", DEFAULT_BUDGET.warnBytes),
      opsWarnPct: num("R2_OPS_WARN_PCT", DEFAULT_BUDGET.opsWarnPct),
      opsMaxPct: num("R2_OPS_MAX_PCT", DEFAULT_BUDGET.opsMaxPct),
    },
  });
  writeFileSync(deleteOut, d.deletePaths.map((p) => `${p}\n`).join(""));
  if (media) {
    writeFileSync(mediaOut, d.mediaUpload.map((p) => `${p}\n`).join(""));
    writeFileSync(orphansFile, JSON.stringify(d.orphans));
  }
  const line = (s: string) => s.replace(/[\r\n]+/g, " ");
  console.log(`UPLOAD=${d.upload ? "yes" : "no"}\nREASON=${line(d.reason ?? "")}\nWARN=${line(d.warnings.join("; "))}\nSUMMARY=${line(d.summary)}`);
}

main().catch((e) => {
  console.error(`r2-budget: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
