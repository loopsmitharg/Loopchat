import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { ContactDetail } from "@/components/crm/contact-detail";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Contacto" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "contact:read")) return <ForbiddenState />;
  const { id } = await params;
  return <ContactDetail id={id} />;
}
