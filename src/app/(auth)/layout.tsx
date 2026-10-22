import { LoopchatLogo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1fr_minmax(420px,520px)]">
      <div className="hidden lg:flex flex-col justify-between bg-ink text-white p-10">
        <LoopchatLogoDark />
        <div className="max-w-md">
          <p className="font-display text-[28px] leading-tight font-semibold">
            Conversaciones de WhatsApp, pipeline comercial y bots en <span className="text-brand">un solo panel</span>.
          </p>
          <ul className="mt-6 space-y-2 text-[14px] text-white/75">
            <li>· Cada empresa con su número oficial de Meta y su propia IA.</li>
            <li>· El bot cede el control al humano sin respuestas cruzadas.</li>
            <li>· Oportunidades vinculadas a cada chat.</li>
          </ul>
        </div>
        <p className="text-[12px] text-white/50">Loopchat by Loop Smiths</p>
      </div>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8">
            <LoopchatLogo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function LoopchatLogoDark() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lc-g2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A3E635" />
            <stop offset="1" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#lc-g2)" />
        <path d="M10.5 20.5c-2.2 0-4-1.8-4-4s1.8-4 4-4c3.6 0 7.4 8 11 8 2.2 0 4-1.8 4-4s-1.8-4-4-4c-1.5 0-3 1.3-4.4 3" fill="none" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="font-display text-[18px] font-bold tracking-tight">
        Loop<span className="text-brand">chat</span>
      </span>
    </span>
  );
}
