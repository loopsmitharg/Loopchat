"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type Permission } from "@/lib/permissions";
import { useSession } from "@/components/shell/app-shell";
import { cn } from "@/components/ui/cn";

const ITEMS: { href: string; label: string; perm: Permission }[] = [
  { href: "/configuracion/empresa", label: "Empresa", perm: "dashboard:read" },
  { href: "/configuracion/equipo", label: "Equipo y permisos", perm: "conversation:read" },
  { href: "/configuracion/whatsapp", label: "WhatsApp", perm: "settings:read" },
  { href: "/configuracion/identidad-ia", label: "Identidad y objetivos de IA", perm: "bot:read" },
  { href: "/configuracion/ia", label: "Proveedores de IA", perm: "bot:read" },
  { href: "/configuracion/pipeline", label: "Pipeline y etapas", perm: "opportunity:read" },
  { href: "/configuracion/conocimiento", label: "Conocimiento (FAQ y documentos)", perm: "knowledge:read" },
  { href: "/configuracion/plan", label: "Plan y consumo", perm: "usage:read" },
  { href: "/configuracion/auditoria", label: "Auditoría", perm: "audit:read" },
];

export function SettingsNav() {
  const pathname = usePathname();
  const { role } = useSession();
  return (
    <nav aria-label="Secciones de configuración" className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.filter((i) => can(role, i.perm)).map((i) => {
        const active = pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-[13px]", active ? "bg-surface-sunken font-semibold text-fg" : "text-fg-secondary hover:bg-surface-muted")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
