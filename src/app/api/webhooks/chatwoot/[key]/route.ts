import { NextResponse, type NextRequest } from "next/server";
import { receiveChatwootWebhook } from "@/server/chatwoot/receive";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const rawBody = await req.text();
  const res = await receiveChatwootWebhook({
    key,
    rawBody,
    signature: req.headers.get("x-chatwoot-signature"),
    timestamp: req.headers.get("x-chatwoot-timestamp"),
    deliveryId: req.headers.get("x-chatwoot-delivery"),
  });
  return NextResponse.json(res.body, { status: res.status });
}
