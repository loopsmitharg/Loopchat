// Simula la API GraphQL de métricas de Cloudflare para tests/ops/backup-r2-e2e.sh (solo pruebas).
// MODE (archivo /t/mock-mode, se relee en cada pedido): ok | full | ops | down. PORT: puerto.
import { readFileSync } from "node:fs";
import http from "node:http";

const mode = () => {
  try {
    return readFileSync("/t/mock-mode", "utf8").trim();
  } catch {
    return "ok";
  }
};
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = mode();
      if (m === "down") return res.writeHead(500).end("{}");
      const q = JSON.parse(body);
      if (!req.headers.authorization?.startsWith("Bearer ") || !q.variables?.account) return res.writeHead(400).end("{}");
      const other = m === "full" ? 7.999e9 : 1.2e9;
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: {
            viewer: {
              accounts: [
                {
                  ops: [
                    { sum: { requests: m === "ops" ? 960_000 : 1200 }, dimensions: { actionType: "PutObject" } },
                    { sum: { requests: 5000 }, dimensions: { actionType: "GetObject" } },
                  ],
                  storage: [
                    { max: { payloadSize: other, metadataSize: 0 }, dimensions: { bucketName: "otro-bucket", datetime: "2026-11-25T02:00:00Z" } },
                    // el propio bucket se mide con el listado exacto: esta cifra (vieja) debe ignorarse
                    { max: { payloadSize: 999e9, metadataSize: 0 }, dimensions: { bucketName: "loopchat-backups", datetime: "2026-11-25T02:00:00Z" } },
                  ],
                },
              ],
            },
          },
        }),
      );
    });
  })
  .listen(Number(process.env.PORT || 8787));
