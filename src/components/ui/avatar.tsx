import { cn } from "./cn";

function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, seed, size = 32, className }: { name: string; seed?: string; size?: number; className?: string }) {
  const hue = hueFor(seed ?? name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 45% 28%)` }}
    >
      {initials(name)}
    </span>
  );
}
