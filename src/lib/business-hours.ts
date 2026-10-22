export type BusinessHours = { enabled: boolean; days: number[]; start: string; end: string };

export const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** ¿Está abierta la empresa en `now` según su zona horaria? Sin horario configurado = siempre abierta. */
export function isWithinBusinessHours(hours: BusinessHours | undefined, timeZone: string, now = new Date()): boolean {
  if (!hours?.enabled) return true;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (!hours.days.includes(wd)) return false;
  const cur = hh * 60 + mm;
  const [sh, sm] = hours.start.split(":").map(Number);
  const [eh, em] = hours.end.split(":").map(Number);
  return cur >= sh * 60 + sm && cur < eh * 60 + em;
}
