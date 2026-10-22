/**
 * SIMULADOR de proveedores de IA (solo desarrollo/tests). Implementa los contratos
 * OpenAI Chat Completions, Anthropic Messages y Gemini generateContent con respuestas
 * deterministas. No es un proveedor real: las pruebas reales requieren claves propias.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.AI_SIM_PORT ?? 3012);
const requests: { provider: string; keyTail: string; model: string; lastUser: string; system: string }[] = [];
let mode: "ok" | "error500" | "slow" = "ok";

/** Clasificación de derivación (equipos): elige la opción cuyo texto comparte una palabra con el mensaje. */
function classify(lastUser: string, system: string) {
  const words = lastUser.toLowerCase().split(/[^a-záéíóúñü0-9]+/).filter((w) => w.length > 4);
  const opts = [...system.matchAll(/^(\d+)\) (.+)$/gm)].filter((o) => o[1] !== "0");
  const hit = opts.find((o) => words.some((w) => o[2].toLowerCase().includes(w)));
  return { option: hit ? Number(hit[1]) : 0, intent: null };
}

function decide(lastUser: string, system = "") {
  const r = decideBase(lastUser, system);
  // marca del bot que respondió (tests de equipos): instrucciones con "[BOT:nombre]"
  const tag = system.match(/\[BOT:([\w-]+)\]/)?.[1];
  if (tag && typeof r.reply === "string") r.reply = `[${tag}${system.includes("TRASPASO INTERNO") ? "+ctx" : ""}] ${r.reply}`;
  return r;
}

function decideBase(lastUser: string, system = ""): Record<string, unknown> {
  const m = lastUser.toLowerCase();
  // casos para probar el módulo de bots (catálogo, fotos, datos comerciales, consultas sin resolver)
  if (m.includes("foto") && /^\[P1\]/m.test(system)) return { reply: "Te paso la foto.", intent: "consulta", handoff: false, photo: "P1", resolved: true };
  const qty = m.match(/\b(\d{1,5})\s+(bolsas|unidades|cajas)/);
  if (qty && /- cantidad \(/.test(system)) return { reply: "Anotado. ¿Para cuándo lo necesitás?", intent: "compra", handoff: false, collected: { cantidad: qty[1], inventado: "x" }, resolved: true };
  if (m.includes("xyzzy")) return { reply: "No tengo esa información.", intent: "otro", handoff: false, resolved: false };
  if (m.includes("catalogo?") || m.includes("catálogo?")) {
    const p1 = system.match(/^\[P1\] (.+?) — Precio: ([^—]+?) —/m);
    return { reply: p1 ? `${p1[1]}: ${p1[2].includes("NO INFORMADO") ? "precio no informado" : p1[2]}` : "No encuentro ese producto.", intent: "precio", handoff: false, resolved: Boolean(p1) };
  }
  if (m.includes("humano") || m.includes("persona")) return { reply: "Te paso con una persona del equipo.", intent: "otro", handoff: true, handoff_reason: "El cliente pidió hablar con una persona" };
  if (m.includes("precio") || m.includes("cuánto") || m.includes("cuanto")) return { reply: "El taladro percutor cuesta $85.000. ¿Querés que te lo reserve?", intent: "precio", handoff: false, opportunity: { title: "Taladro percutor", amount: 85000 }, stage: "Cotizado" };
  if (m.includes("seguimiento")) return { reply: "Te contactamos mañana.", intent: "consulta", handoff: false, task: { title: "Llamar al cliente", due_in_hours: 24 } };
  return { reply: "¡Hola! Soy el asistente. ¿En qué te puedo ayudar?", intent: "consulta", handoff: false };
}

async function read(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/__sim/requests") return send(res, 200, requests);
  if (url.pathname === "/__sim/reset") {
    requests.length = 0;
    mode = "ok";
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__sim/mode") {
    mode = (url.searchParams.get("m") as typeof mode) ?? "ok";
    return send(res, 200, { mode });
  }
  const b = await read(req);
  let provider = "";
  let key = "";
  let lastUser = "";
  let system = "";
  if (url.pathname.endsWith("/chat/completions")) {
    provider = "openai_compatible";
    key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const msgs = b.messages as { role: string; content: string }[];
    lastUser = msgs.filter((x) => x.role === "user").at(-1)?.content ?? "";
    system = msgs.find((x) => x.role === "system")?.content ?? "";
  } else if (url.pathname.endsWith("/v1/messages")) {
    provider = "anthropic";
    key = String(req.headers["x-api-key"] ?? "");
    lastUser = (b.messages as { role: string; content: string }[]).filter((x) => x.role === "user").at(-1)?.content ?? "";
    system = String(b.system ?? "");
  } else if (url.pathname.includes(":generateContent")) {
    provider = "gemini";
    key = String(req.headers["x-goog-api-key"] ?? "");
    lastUser = (b.contents as { role: string; parts: { text: string }[] }[]).filter((x) => x.role === "user").at(-1)?.parts[0]?.text ?? "";
    system = (b.systemInstruction as { parts: { text: string }[] })?.parts?.[0]?.text ?? "";
  } else return send(res, 404, { error: { message: "not found" } });

  requests.push({ provider, keyTail: key.slice(-4), model: String(b.model ?? url.pathname.split("/models/")[1]?.split(":")[0] ?? ""), lastUser, system });
  if (key.startsWith("sk-bad") || key.length < 10) return send(res, 401, { error: { message: "Invalid API key" } });
  if (mode === "error500") return send(res, 500, { error: { message: "Upstream overloaded" } });
  if (mode === "slow") await new Promise((r) => setTimeout(r, 5000));
  const text = lastUser === "ping" ? "ok" : system.startsWith("Clasificás mensajes") ? JSON.stringify(classify(lastUser, system)) : JSON.stringify(decide(lastUser, system));
  if (provider === "openai_compatible") return send(res, 200, { model: b.model, choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
  if (provider === "anthropic") return send(res, 200, { model: b.model, content: [{ type: "text", text }], usage: { input_tokens: 50, output_tokens: 20 } });
  return send(res, 200, { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 } });
}).listen(PORT, () => console.log(`[ai-sim] SIMULADOR de IA en http://localhost:${PORT} (no es un proveedor real)`));
