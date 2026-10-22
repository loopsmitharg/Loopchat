"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Bot,
  Building2,
  ChevronDown,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { can, type Permission, type Role, ROLE_LABELS } from "@/lib/permissions";
import { api, useOnline } from "@/lib/api-client";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { LoopchatLogo, LoopchatMark } from "@/components/ui/logo";
import { OfflineBanner } from "@/components/ui/states";
import { ToastProvider } from "@/components/ui/toast";

export type ShellSession = {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string; status: string };
  role: Role;
  memberships: { tenantId: string; tenantName: string }[];
  isPlatformAdmin: boolean;
  operational: boolean;
  planName: string;
  subscriptionStatus: string;
};

const SessionCtx = createContext<ShellSession | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession fuera del shell");
  return s;
}
export function useCan(p: Permission) {
  return can(useSession().role, p);
}

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:read" },
  { href: "/conversaciones", label: "Conversaciones", icon: MessagesSquare, permission: "conversation:read" },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, permission: "opportunity:read" },
  { href: "/contactos", label: "Contactos", icon: Users, permission: "contact:read" },
  { href: "/tareas", label: "Tareas", icon: ListChecks, permission: "task:read" },
  { href: "/chatbots", label: "Chatbots", icon: Bot, permission: "bot:read" },
  { href: "/configuracion", label: "Configuración", icon: Settings, permission: "dashboard:read" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const session = useSession();
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {NAV.filter((n) => can(session.role, n.permission)).map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13.5px] transition-colors",
              active ? "bg-surface-sunken font-semibold text-fg" : "text-fg-secondary hover:bg-surface-muted hover:text-fg",
            )}
          >
            <Icon className={cn("size-[18px]", active ? "text-brand-strong" : "text-fg-muted group-hover:text-fg-secondary")} aria-hidden />
            {n.label}
            {active ? <span className="ml-auto size-1.5 rounded-full bg-brand" aria-hidden /> : null}
          </Link>
        );
      })}
      {session.isPlatformAdmin ? (
        <Link
          href="/admin"
          onClick={onNavigate}
          className="mt-3 flex items-center gap-2.5 rounded-[7px] border border-dashed border-border-strong px-2.5 py-2 text-[13px] text-fg-secondary hover:bg-surface-muted"
        >
          <ShieldCheck className="size-[18px] text-fg-muted" aria-hidden /> Panel Loop Smiths
        </Link>
      ) : null}
    </nav>
  );
}

function TenantSwitcher() {
  const s = useSession();
  const router = useRouter();
  if (s.memberships.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium">
        <Building2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="truncate">{s.tenant.name}</span>
      </div>
    );
  }
  return (
    <label className="relative flex min-w-0 items-center gap-2 text-[13.5px] font-medium">
      <Building2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="sr-only">Empresa activa</span>
      <select
        className="max-w-[220px] appearance-none truncate rounded-md bg-transparent py-1 pr-6 font-medium hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        value={s.tenant.id}
        onChange={async (e) => {
          await api("/api/v1/session/tenant", { body: { tenantId: e.target.value } });
          router.refresh();
          router.push("/dashboard");
        }}
      >
        {s.memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenantName}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 size-3.5 text-fg-muted" aria-hidden />
    </label>
  );
}

function AccountMenu() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-surface-muted"
      >
        <Avatar name={s.user.name} seed={s.user.id} size={30} />
        <span className="hidden text-[13px] font-medium md:inline">{s.user.name.split(" ")[0]}</span>
        <ChevronDown className="hidden size-3.5 text-fg-muted md:inline" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-64 rounded-[10px] border border-border bg-surface p-1 shadow-[0_12px_32px_rgb(15_23_42/0.14)]" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="px-3 py-2">
            <p className="text-[13px] font-medium">{s.user.name}</p>
            <p className="truncate text-[12px] text-fg-muted">{s.user.email}</p>
            <p className="mt-1 text-[12px] text-fg-muted">
              {ROLE_LABELS[s.role]} · {s.tenant.name}
            </p>
          </div>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-surface-muted"
            onClick={async () => {
              await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="size-4 text-fg-muted" aria-hidden /> Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ session, children }: { session: ShellSession; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const online = useOnline();
  return (
    <SessionCtx.Provider value={session}>
      <ToastProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Saltar al contenido
        </a>
        <div className="flex min-h-dvh">
          <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
            <Link href="/dashboard" className="mb-6 px-1.5" aria-label="Loopchat, ir al dashboard">
              <LoopchatLogo />
            </Link>
            <NavLinks />
            <div className="mt-auto rounded-[8px] border border-border bg-surface-muted px-3 py-2.5 text-[12px] text-fg-muted">
              Plan <span className="font-medium text-fg-secondary">{session.planName}</span>
              {!session.operational ? <p className="mt-1 font-medium text-danger">Cuenta suspendida: solo lectura</p> : null}
            </div>
          </aside>

          {drawer ? (
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
              <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
              <div className="relative flex h-full w-[260px] flex-col bg-surface px-3 py-4 shadow-xl">
                <div className="mb-6 flex items-center justify-between px-1.5">
                  <LoopchatLogo />
                  <button type="button" onClick={() => setDrawer(false)} aria-label="Cerrar menú" className="rounded p-1 hover:bg-surface-muted">
                    <X className="size-5" />
                  </button>
                </div>
                <NavLinks onNavigate={() => setDrawer(false)} />
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
              <button type="button" className="rounded p-1.5 hover:bg-surface-muted lg:hidden" aria-label="Abrir menú" onClick={() => setDrawer(true)}>
                <Menu className="size-5" />
              </button>
              <span className="lg:hidden">
                <LoopchatMark size={26} />
              </span>
              <TenantSwitcher />
              <div className="ml-auto flex items-center gap-2">
                <AccountMenu />
              </div>
            </header>
            {!online ? <OfflineBanner /> : null}
            {!session.operational ? (
              <div role="status" className="border-b border-[#fecdca] bg-danger-soft px-5 py-2 text-[13px] text-danger">
                La suscripción de la empresa está suspendida o cancelada. Podés consultar el historial, pero no se envían mensajes ni se ejecutan bots.
              </div>
            ) : null}
            <main id="main" className="min-w-0 flex-1">
              {children}
            </main>
          </div>
        </div>
      </ToastProvider>
    </SessionCtx.Provider>
  );
}
