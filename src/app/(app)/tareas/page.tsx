import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { TasksView } from "@/components/crm/tasks-view";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Tareas" };

export default async function TasksPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "task:read")) return <ForbiddenState />;
  return <TasksView />;
}
