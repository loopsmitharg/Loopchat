import { tenantRoute, readJson } from "@/server/http/api";
import { addNote, noteSchema } from "@/server/services/notes";

export const POST = tenantRoute(async ({ req, ctx }) => addNote(ctx, await readJson(req, noteSchema)));
