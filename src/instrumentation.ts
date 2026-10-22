/**
 * Al iniciar el servidor: valida la configuración (falla rápido ante variables faltantes o
 * inseguras) y, si LOOPCHAT_INLINE_WORKER=true (desarrollo), procesa la cola periódicamente
 * dentro del mismo proceso. En producción la cola la procesa `npm run worker`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./server/env");
  env();
  if (process.env.LOOPCHAT_INLINE_WORKER === "true") {
    const g = globalThis as unknown as { __loopchatInlineWorker?: NodeJS.Timeout };
    if (!g.__loopchatInlineWorker) {
      const { drainOnce } = await import("./server/jobs/worker");
      g.__loopchatInlineWorker = setInterval(() => {
        void drainOnce().catch(() => undefined);
      }, 2000);
      g.__loopchatInlineWorker.unref?.();
    }
  }
}
