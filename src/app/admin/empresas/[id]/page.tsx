import { TenantDetailAdmin } from "@/components/admin/tenant-detail";

export const metadata = { title: "Empresa" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetailAdmin id={id} />;
}
