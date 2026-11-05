import { readFormLimited, tenantRoute } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";
import { MAX_FILE_BYTES, uploadKnowledgeFile } from "@/server/services/knowledge";

export const POST = tenantRoute(
  async ({ req, ctx }) => {
    const form = await readFormLimited(req, MAX_FILE_BYTES + 64 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Adjuntá un archivo.");
    if (file.size > MAX_FILE_BYTES) throw badRequest("El archivo supera los 5 MB.");
    return uploadKnowledgeFile(ctx, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  },
  { permission: "knowledge:write", rateLimit: { max: 20 } },
);
