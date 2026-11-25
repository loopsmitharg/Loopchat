/**
 * Presupuesto de la copia externa en Cloudflare R2 (franquicia gratuita, compartida por toda la cuenta).
 * Lógica pura: decide qué backups remotos vencieron, si el nuevo entra bajo el tope y qué avisar.
 * Reglas: solo se borran copias vencidas (o incompletas), nunca la última copia completa; si no hay
 * espacio no se sube y no se borra nada válido para hacer lugar.
 */
export type RemoteObject = { Path: string; Size: number };
export type BudgetConfig = {
  retentionDays: number;
  maxBytes: number; // tope operativo de la cuenta (8 GB)
  warnBytes: number; // aviso (6 GB)
  freeClassA: number; // operaciones/mes de la franquicia
  freeClassB: number;
  opsWarnPct: number;
  opsMaxPct: number;
};
export type BudgetInput = {
  objects: RemoteObject[]; // todo el bucket (rclone lsjson -R), rutas relativas al bucket
  prefix: string; // carpeta de los backups dentro del bucket ("" = raíz)
  incomingBytes: number;
  otherBucketsBytes: number; // resto de la cuenta (API de métricas de Cloudflare)
  classA: number; // operaciones del mes en curso, toda la cuenta
  classB: number;
  now: Date;
  cfg: BudgetConfig;
  media?: MediaInput;
};
/** Adjuntos de Chatwoot: se suben cifrados de a uno, una sola vez, a `<prefijo>/media/<ruta>.enc`. */
export type MediaInput = {
  local: { path: string; size: number }[]; // archivos del storage de Chatwoot (rutas relativas)
  keyBytes: number; // tamaño de la clave RSA en bytes (la cabecera de cada objeto cifrado)
  orphans: Record<string, string>; // ruta → ISO de cuándo se vio que ya no existe localmente
};
export type BudgetDecision = {
  upload: boolean;
  reason: string | null;
  deletePaths: string[];
  warnings: string[];
  summary: string;
  mediaUpload: string[];
  orphans: Record<string, string>;
};

/** Tamaño exacto del objeto cifrado: clave envuelta (RSA) + AES-256-CBC con relleno PKCS#7. */
export const encryptedSize = (plainBytes: number, keyBytes: number) => keyBytes + (Math.floor(plainBytes / 16) + 1) * 16;

export const DEFAULT_BUDGET: BudgetConfig = {
  retentionDays: 7,
  maxBytes: 8e9,
  warnBytes: 6e9,
  freeClassA: 1_000_000,
  freeClassB: 10_000_000,
  opsWarnPct: 80,
  opsMaxPct: 95,
};

// Clasificación oficial (developers.cloudflare.com/r2/pricing). Lo no listado se cuenta como Clase A (conservador).
const CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
const FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);

export function classifyOps(rows: { actionType: string; requests: number }[]) {
  let classA = 0;
  let classB = 0;
  for (const r of rows) {
    if (FREE.has(r.actionType)) continue;
    if (CLASS_B.has(r.actionType)) classB += r.requests;
    else classA += r.requests;
  }
  return { classA, classB };
}

const PARTS = ["tar.enc", "key.enc", "sha256"] as const;
const NAME_RE = /^loopchat-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.(tar\.enc|key\.enc|sha256)$/;
const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;

export function decide(input: BudgetInput): BudgetDecision {
  const { cfg, now } = input;
  const dir = input.prefix.replace(/^\/+|\/+$/g, "");
  const sets = new Map<string, { at: number; parts: Set<string>; paths: string[]; bytes: number }>();
  let bucketBytes = 0;
  for (const o of input.objects) {
    bucketBytes += o.Size;
    const slash = o.Path.lastIndexOf("/");
    if ((slash < 0 ? "" : o.Path.slice(0, slash)) !== dir) continue;
    const m = NAME_RE.exec(o.Path.slice(slash + 1));
    if (!m) continue;
    const stamp = `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
    const s = sets.get(stamp) ?? { at: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), parts: new Set(), paths: [], bytes: 0 };
    s.parts.add(m[7]);
    s.paths.push(o.Path);
    s.bytes += o.Size;
    sets.set(stamp, s);
  }

  const all = [...sets.values()].sort((a, b) => b.at - a.at);
  const complete = all.filter((s) => PARTS.every((p) => s.parts.has(p)));
  const latestValid = complete[0];
  const cutoff = now.getTime() - cfg.retentionDays * 86_400_000;
  const doomed = all.filter((s) => s !== latestValid && (s.at < cutoff || !PARTS.every((p) => s.parts.has(p))));
  const md = planMedia(input, dir);
  const freed = doomed.reduce((n, s) => n + s.bytes, 0) + md.freed;
  const incoming = input.incomingBytes + md.incoming;

  const warnings: string[] = [];
  let reason: string | null = null;
  const after = bucketBytes - freed + input.otherBucketsBytes + incoming;
  if (after > cfg.maxBytes) reason = `sin espacio: la cuenta quedaría en ${gb(after)} (tope ${gb(cfg.maxBytes)})`;
  else if (after >= cfg.warnBytes) warnings.push(`almacenamiento R2 en ${gb(after)} (aviso desde ${gb(cfg.warnBytes)})`);

  for (const [label, used, free] of [["A", input.classA, cfg.freeClassA], ["B", input.classB, cfg.freeClassB]] as const) {
    const pct = Math.round((used / free) * 100);
    if (pct >= cfg.opsMaxPct) reason ??= `operaciones Clase ${label} del mes al ${pct} % de la franquicia`;
    else if (pct >= cfg.opsWarnPct) warnings.push(`operaciones Clase ${label} del mes al ${pct} % de la franquicia`);
  }

  // proyección con la retención actual: ~retentionDays+1 copias en el pico diario
  const avg = complete.length ? complete.reduce((n, s) => n + s.bytes, 0) / complete.length : input.incomingBytes;
  // los adjuntos son una sola copia: cuentan una vez, no por día de retención
  const fixed = bucketBytes - all.reduce((n, s) => n + s.bytes, 0) - md.freed + md.incoming + input.otherBucketsBytes;
  const projected = fixed + avg * (cfg.retentionDays + 1);
  if (avg > 0 && projected >= cfg.warnBytes) {
    const fit = Math.floor((cfg.warnBytes - fixed) / avg) - 1;
    warnings.push(`con ${cfg.retentionDays} días de retención se proyectan ${gb(projected)}; ${fit >= 1 ? `entran ${fit} días bajo ${gb(cfg.warnBytes)}` : "no entra ni una semana: revisar qué se respalda"}`);
  }

  const media = input.media ? `, adjuntos: ${md.upload.length} nuevos (${gb(md.incoming)}), ${md.delete.length} huérfanos borrados` : "";
  const summary = `R2 cuenta ${gb(after)} tras el backup (otros buckets ${gb(input.otherBucketsBytes)}), ${complete.length} copias completas, se borran ${doomed.length} vencidas/incompletas${media}, proyección ${gb(projected)}, ops A ${input.classA}/B ${input.classB}`;
  return { upload: reason === null, reason, deletePaths: [...doomed.flatMap((s) => s.paths), ...md.delete], warnings, summary, mediaUpload: md.upload, orphans: md.orphans };
}

/**
 * Qué adjuntos subir (faltan en R2 o su tamaño no coincide: subida incompleta) y cuáles borrar. Un adjunto que ya no
 * existe localmente se conserva `retentionDays` desde que se detectó su ausencia, porque los backups de base
 * de esos días todavía lo referencian.
 */
function planMedia(input: BudgetInput, dir: string) {
  const out = { upload: [] as string[], delete: [] as string[], incoming: 0, freed: 0, orphans: {} as Record<string, string> };
  if (!input.media) return out;
  const { local, keyBytes, orphans } = input.media;
  const base = `${dir ? `${dir}/` : ""}media/`;
  const remote = new Map<string, number>();
  for (const o of input.objects) if (o.Path.startsWith(base) && o.Path.endsWith(".enc")) remote.set(o.Path.slice(base.length, -4), o.Size);
  const here = new Set<string>();
  for (const f of local) {
    here.add(f.path);
    const want = encryptedSize(f.size, keyBytes);
    if (remote.get(f.path) === want) continue;
    out.upload.push(f.path);
    out.incoming += want;
  }
  const cutoff = input.now.getTime() - input.cfg.retentionDays * 86_400_000;
  for (const [path, size] of remote) {
    if (here.has(path)) continue;
    const since = orphans[path] ?? input.now.toISOString();
    if (Date.parse(since) < cutoff) {
      out.delete.push(`${base}${path}.enc`);
      out.freed += size;
    } else out.orphans[path] = since;
  }
  return out;
}
