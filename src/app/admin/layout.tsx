import Link from "next/link";
import { requirePlatformPage } from "@/server/authz/page";
import { LoopchatLogo } from "@/components/ui/logo";
import { ToastProvider } from "@/components/ui/toast";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Panel Loop Smiths", template: "%s · Panel Loop Smiths" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformPage();
  return (
    <ToastProvider>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-ink px-4 text-white sm:px-6">
        <Link href="/admin" className="rounded bg-white/95 px-1.5 py-1">
          <LoopchatLogo />
        </Link>
        <span className="hidden text-[13px] font-semibold text-brand sm:inline">Panel Loop Smiths</span>
        <nav aria-label="Panel" className="flex gap-1 text-[13px]">
          <Link href="/admin" className="rounded px-2.5 py-1.5 hover:bg-white/10">
            Empresas
          </Link>
          <Link href="/admin/planes" className="rounded px-2.5 py-1.5 hover:bg-white/10">
            Planes
          </Link>
          <Link href="/dashboard" className="rounded px-2.5 py-1.5 text-white/70 hover:bg-white/10">
            Ir a la app
          </Link>
        </nav>
        <span className="ml-auto hidden text-[12.5px] text-white/70 md:inline">{user.email}</span>
      </header>
      <main id="main" className="mx-auto max-w-6xl p-4 sm:p-6">
        {children}
      </main>
    </ToastProvider>
  );
}
