import { tenantRoute, readJson } from "@/server/http/api";
import { contactInputSchema, createContact, listContacts } from "@/server/services/contacts";

export const GET = tenantRoute(async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  return listContacts(ctx, { q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined, page: Number(sp.get("page") ?? 1) });
});
export const POST = tenantRoute(async ({ req, ctx }) => createContact(ctx, await readJson(req, contactInputSchema)));
