import { createServer, type Server } from "node:http";

/**
 * Proveedor de IA guionado (OpenAI-compatible) para pruebas: cada test fija qué "decide" el modelo.
 * Valida las guardas del servidor, no la calidad de un modelo real.
 */
export type Scripted = { content?: string; status?: number; delayMs?: number; finishReason?: string };
export type ScriptedCall = { system: string; messages: { role: string; content: string }[]; at: number };

export function scriptedAi(port: number) {
  const queue: Scripted[] = [];
  const calls: ScriptedCall[] = [];
  /** Reglas por contenido del prompt (tienen prioridad sobre la cola), p. ej. latencia por empresa. */
  const rules: ((c: ScriptedCall) => Scripted | undefined)[] = [];
  let fallback = JSON.stringify({ reply: "¡Hola! ¿En qué te ayudo?", intent: "consulta", handoff: false });
  let server: Server | null = null;
  return {
    calls,
    rules,
    url: `http://localhost:${port}/v1`,
    push: (...r: (Scripted | string)[]) => queue.push(...r.map((x) => (typeof x === "string" ? { content: x } : x))),
    setDefault: (c: string) => (fallback = c),
    reset() {
      queue.length = 0;
      calls.length = 0;
      rules.length = 0;
      fallback = JSON.stringify({ reply: "¡Hola! ¿En qué te ayudo?", intent: "consulta", handoff: false });
    },
    lastUser: (i = -1) => calls.at(i)?.messages.filter((m) => m.role === "user").at(-1)?.content,
    async start() {
      server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const b = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { messages: { role: string; content: string }[] };
        const call = { system: b.messages.find((m) => m.role === "system")?.content ?? "", messages: b.messages, at: Date.now() };
        calls.push(call);
        const s = rules.map((r) => r(call)).find(Boolean) ?? queue.shift() ?? { content: fallback };
        if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs));
        if (s.status && s.status >= 400) {
          res.writeHead(s.status, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "simulated provider failure" } }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "x", model: "scripted", choices: [{ index: 0, finish_reason: s.finishReason ?? "stop", message: { role: "assistant", content: s.content ?? fallback } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      });
      await new Promise<void>((r) => server!.listen(port, r));
    },
    stop: () => server?.close(),
  };
}

export const decision = (o: Record<string, unknown>) => JSON.stringify({ intent: "consulta", handoff: false, ...o });
