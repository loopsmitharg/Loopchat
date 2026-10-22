/**
 * SOLO demo local: chat por consola como si fueras un CLIENTE escribiendo por WhatsApp a la
 * empresa DEMO "Ferretería Norte". Cada línea que escribís entra a Loopchat como mensaje
 * entrante (vía el simulador de Chatwoot) y se muestran las respuestas del bot o del vendedor.
 * Uso: npm run demo:chat -- [telefono] [nombre]
 */
import { createInterface } from "node:readline";

const SIM = process.env.CHATWOOT_SIM_URL ?? "http://localhost:3011";
const phone = process.argv[2] ?? "+5491155550123";
const name = process.argv[3] ?? "Cliente de prueba (DEMO)";

type Msg = { id: number; content: string | null; message_type: number; private: boolean; sender?: { name?: string; type?: string } | null };
type State = { accounts: { id: number; name: string; inboxes: unknown[]; contacts: { id: number; phone_number: string }[]; conversations: { id: number; contact_id: number; messages: Msg[] }[] }[] };

const getState = async () => (await (await fetch(`${SIM}/__sim/state`)).json()) as State;

async function main() {
  const state = await getState().catch(() => {
    throw new Error("No se pudo conectar con el simulador (puerto 3011). ¿Está corriendo iniciar-demo.cmd?");
  });
  const acc = state.accounts.find((a) => a.name.includes("Ferreter") && a.inboxes.length > 0) ?? state.accounts.find((a) => a.inboxes.length > 0);
  if (!acc) throw new Error("El simulador no tiene empresas conectadas. Ejecutá detener-demo.cmd y después iniciar-demo.cmd.");

  // no repetir mensajes viejos: se marca como visto todo lo que ya existe
  const seen = new Set<number>();
  for (const c of acc.conversations) for (const m of c.messages) seen.add(m.id);

  console.log(`\nChateando con "${acc.name}" como ${name} (${phone}).`);
  console.log("Escribí un mensaje y Enter para enviarlo. Las respuestas aparecen solas. Para salir: /salir\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "Vos: " });

  async function poll() {
    try {
      const s = await getState();
      const a = s.accounts.find((x) => x.id === acc!.id);
      const contact = a?.contacts.find((c) => c.phone_number === phone);
      if (!a || !contact) return;
      for (const conv of a.conversations.filter((c) => c.contact_id === contact.id)) {
        for (const m of conv.messages) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          if (m.message_type === 1 && !m.private && m.content) {
            process.stdout.write(`\r\x1b[K${acc!.name.replace(" (Loopchat)", "")}: ${m.content}\n`);
            rl.prompt(true);
          }
        }
      }
    } catch {
      /* simulador momentáneamente no disponible */
    }
  }
  const timer = setInterval(poll, 1500);

  rl.on("line", async (line) => {
    const content = line.trim();
    if (content === "/salir") return rl.close();
    if (!content) return rl.prompt();
    try {
      const res = await fetch(`${SIM}/__sim/incoming`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: acc.id, phone, name, content }) });
      if (!res.ok) console.log(`(no se pudo enviar: el simulador respondió ${res.status})`);
      else {
        const { messageId } = (await res.json()) as { messageId: number };
        seen.add(messageId);
      }
    } catch {
      console.log("(no se pudo enviar: ¿sigue abierto el simulador?)");
    }
    rl.prompt();
  });
  rl.on("close", () => {
    clearInterval(timer);
    console.log("\nChat terminado.");
    process.exit(0);
  });
  rl.prompt();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
