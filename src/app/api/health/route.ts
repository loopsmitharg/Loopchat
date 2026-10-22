import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/server/crypto/vault";
import { checkHealth } from "@/server/services/ops";

export async function GET(req: NextRequest) {
  const h = await checkHealth();
  const token = process.env.HEALTH_TOKEN;
  const provided = req.headers.get("x-health-token") ?? "";
  const detailed = token ? safeEqual(provided, token) : process.env.NODE_ENV !== "production";
  const body = detailed ? h : { status: h.status, database: h.database };
  return NextResponse.json(body, { status: h.database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
