// HARNESS DE AUDITORÍA — carga HTTP moderada contra una instancia LOCAL (idealmente `next start`).
// Mide latencias p50/p95/p99 de endpoints de lectura con concurrencia creciente. Solo lectura, datos DEMO.
// Uso: node tests/audit/load.audit.mjs http://localhost:3200
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const login = async (email) => {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, password: "demo-loopchat-123" }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
};
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];

const cookies = [await login("admin@ferreteria.demo.loopchat.test"), await login("admin@optica.demo.loopchat.test")];
// pipeline propio de cada sesión (pedir el de otra empresa da 404, correcto)
const pids = [];
for (const c of cookies) pids.push((await (await fetch(`${BASE}/api/v1/pipelines`, { headers: { cookie: c } })).text()).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0]);
const endpoints = ["/api/v1/conversations?assignee=all&status=open&mode=all&q=", "/api/v1/board?pipelineId={PID}&q=", "/api/v1/metrics", "/api/v1/contacts", "/api/v1/bots", "/api/health"];

async function run(conc, total) {
  const lat = [];
  let errors = 0;
  let i = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: conc }, async (_, w) => {
      while (i < total) {
        const n = i++;
        const ep = endpoints[n % endpoints.length];
        const s = performance.now();
        try {
          const r = await fetch(BASE + ep.replace("{PID}", pids[w % 2]), { headers: { cookie: cookies[w % 2] } });
          await r.arrayBuffer();
          if (!r.ok) errors++;
        } catch {
          errors++;
        }
        lat.push(performance.now() - s);
      }
    }),
  );
  lat.sort((a, b) => a - b);
  const secs = (Date.now() - t0) / 1000;
  return { concurrency: conc, requests: total, errors, rps: Math.round(total / secs), p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)), max: Math.round(lat.at(-1)) };
}

await run(4, 60); // calentamiento
const results = [];
for (const [c, n] of [[1, 120], [10, 600], [25, 1000], [50, 1500]]) results.push(await run(c, n));
console.table(results);
const out = path.resolve(import.meta.dirname, "../../docs/audits/evidence");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "load-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, endpoints, results }, null, 2));
