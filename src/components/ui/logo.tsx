import { useId } from "react";

/** Marca de Loopchat: monograma de lazo en el degradé lima→esmeralda de Loop Smiths. Asset original. */
export function LoopchatMark({ size = 28 }: { size?: number }) {
  const gid = `lc-g-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A3E635" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gid})`} />
      <path
        d="M10.5 20.5c-2.2 0-4-1.8-4-4s1.8-4 4-4c3.6 0 7.4 8 11 8 2.2 0 4-1.8 4-4s-1.8-4-4-4c-1.5 0-3 1.3-4.4 3"
        fill="none"
        stroke="#0F172A"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoopchatLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LoopchatMark />
      {compact ? null : (
        <span className="leading-none">
          <span className="block font-display text-[17px] font-bold tracking-tight text-fg">
            Loop<span className="text-brand-strong">chat</span>
          </span>
          <span className="block text-[10.5px] text-fg-muted mt-0.5">by Loop Smiths</span>
        </span>
      )}
    </span>
  );
}
