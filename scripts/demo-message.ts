/**
 * SOLO demo local: simula un mensaje de WhatsApp entrante para la empresa DEMO
 * "Ferretería Norte" a través del simulador de Chatwoot (puerto 3011).
 * Uso: npm run demo:message -- "texto" [telefono] [nombre]
 */
const SIM = process.env.CHATWOOT_SIM_URL ?? "http://localhost:3011";

async function main() {
  const [content = "Hola, ¿tienen taladros en stock?", phone = "+5491155550123", name = "Cliente de prueba (DEMO)"] = process.argv.slice(2);
  const state = (await (await fetch(`${SIM}/__sim/state`)).json()) as { accounts: { id: number; name: string; inboxes: unknown[] }[] };
  const acc = state.accounts.find((a) => a.name.includes("Ferreter") && a.inboxes.length > 0) ?? state.accounts.find((a) => a.inboxes.length > 0);
  if (!acc) throw new Error("El simulador no tiene empresas conectadas (se reinició sin su estado). Ejecutá detener-demo.cmd y después iniciar-demo.cmd.");
  const res = await fetch(`${SIM}/__sim/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: acc.id, phone, name, content }),
  });
  if (!res.ok) throw new Error(`El simulador respondió ${res.status}: ${await res.text()}`);
  console.log(`Mensaje simulado enviado a "${acc.name}" desde ${phone}: ${content}`);
  console.log("Abrí Conversaciones en http://localhost:3000 para verlo (y la respuesta del bot si está activo).");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
