import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, readBodyLimited } from "@/server/http/api";
import { MAX_WEBHOOK_BODY, receiveChatwootWebhook } from "@/server/chatwoot/receive";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  // clave opaca con formato fijo: se rechaza antes de leer el cuerpo
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let rawBody: string;
  try {
    rawBody = (await readBodyLimited(req, MAX_WEBHOOK_BODY)).toString("utf8");
  } catch (e) {
    return errorResponse(e);
  }
  const res = await receiveChatwootWebhook({
    key,
    rawBody,
    signature: req.headers.get("x-chatwoot-signature"),
    timestamp: req.headers.get("x-chatwoot-timestamp"),
    deliveryId: req.headers.get("x-chatwoot-delivery"),
  });
  return NextResponse.json(res.body, { status: res.status });
}
