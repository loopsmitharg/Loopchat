import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { ContactsList } from "@/components/crm/contacts-list";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Contactos" };

export default async function ContactsPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "contact:read")) return <ForbiddenState />;
  return <ContactsList />;
}
