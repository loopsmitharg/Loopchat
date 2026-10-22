import { requirePageContext } from "@/server/authz/page";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageContext();
  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-4 font-display text-[22px] font-semibold tracking-tight">Configuración</h1>
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
