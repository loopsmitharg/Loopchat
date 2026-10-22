import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider, adaptQuirks } from "@/server/ai/openai-compatible";

// Imita a los modelos nuevos de OpenAI: rechazan max_tokens y temperature != 1.
let server: Server;
let base = "";
const bodies: Record<string, unknown>[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(b);
      res.setHeader("content-type", "application/json");
      if ("max_tokens" in b) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }));
      }
      if ("temperature" in b) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported." } }));
      }
      res.end(JSON.stringify({ model: b.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("OpenAI compatible: adaptación de parámetros", () => {
  it("cambia max_tokens→max_completion_tokens y quita temperature según el error del proveedor", async () => {
    const p = new OpenAiCompatibleProvider("sk-test", base);
    expect(await p.verify("gpt-5.6-luna")).toEqual({ ok: true });
    const last = bodies.at(-1)!;
    expect(last.max_completion_tokens).toBeGreaterThanOrEqual(16);
    expect("max_tokens" in last).toBe(false);
    expect("temperature" in last).toBe(false);
    // la segunda llamada usa lo aprendido: un solo request
    const before = bodies.length;
    const r = await p.chat({ model: "gpt-5.6-luna", system: "s", messages: [{ role: "user", content: "hola" }] });
    expect(r.text).toBe("ok");
    expect(bodies.length - before).toBe(1);
  });

  it("no reintenta errores que no son de parámetros", () => {
    const q = { tokenParam: "max_tokens" as const, temperature: true, jsonMode: true };
    expect(adaptQuirks(q, "The model `x` does not exist")).toBeNull();
    expect(adaptQuirks(q, "Unsupported parameter: 'max_tokens'")?.tokenParam).toBe("max_completion_tokens");
  });
});
