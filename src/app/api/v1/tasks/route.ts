import { tenantRoute, readJson } from "@/server/http/api";
import { createTask, listTasks, taskSchema } from "@/server/services/tasks";

export const GET = tenantRoute(async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  return listTasks(ctx, { scope: (sp.get("scope") as "mine" | "all") ?? "all", status: (sp.get("status") as "pending" | "done" | "cancelled") ?? "pending" });
});
export const POST = tenantRoute(async ({ req, ctx }) => createTask(ctx, await readJson(req, taskSchema)));
