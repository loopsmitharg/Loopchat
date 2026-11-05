import { readFormLimited, tenantRoute } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";
import { deleteProductPhoto, MAX_PHOTO_BYTES, readProductPhoto, uploadProductPhoto } from "@/server/services/products";

/** Foto con acceso controlado: solo usuarios de la empresa dueña del producto. */
export const GET = tenantRoute(async ({ ctx, params }) => {
  const p = await readProductPhoto(ctx, params.id);
  return new Response(new Uint8Array(p.bytes), {
    headers: {
      "content-type": p.mime,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      etag: `"${p.sha.slice(0, 16)}"`,
    },
  });
});

export const POST = tenantRoute(
  async ({ req, ctx, params }) => {
    const form = await readFormLimited(req, MAX_PHOTO_BYTES + 64 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Adjuntá una imagen.");
    if (file.size > MAX_PHOTO_BYTES) throw badRequest("La foto supera los 5 MB.");
    return uploadProductPhoto(ctx, params.id, Buffer.from(await file.arrayBuffer()));
  },
  { permission: "catalog:write", rateLimit: { max: 30 } },
);

export const DELETE = tenantRoute(async ({ ctx, params }) => deleteProductPhoto(ctx, params.id));
