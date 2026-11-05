-- 0004 · Confiabilidad del motor (auditoría 2026-11-04): leases de jobs/ejecuciones, una ejecución activa
-- por conversación, mensaje pendiente por conversación, caché de generaciones de IA e idempotencia de tareas.
-- Aditiva. Reversión: DROP INDEX tasks_idem_uq, jobs_tenant_running_idx, flow_runs_active_conv_uq; DROP TABLE ai_turn_results;
-- ALTER TABLE ... DROP COLUMN pending_bot_message / lease_owner / lease_until / locked_by / idempotency_key.
CREATE TABLE "ai_turn_results" (
	"key" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"text" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pending_bot_message" jsonb;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ai_turn_results" ADD CONSTRAINT "ai_turn_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Datos existentes: si una conversación tuviera más de una ejecución activa (posible antes de esta
-- migración), se conserva la más reciente y las demás se cancelan para poder crear el índice único.
UPDATE "flow_runs" f SET "status" = 'cancelled', "last_error" = 'Ejecución duplicada cancelada por la migración 0004', "finished_at" = now()
WHERE f."status" IN ('queued', 'running')
  AND EXISTS (SELECT 1 FROM "flow_runs" g WHERE g."conversation_id" = f."conversation_id" AND g."status" IN ('queued', 'running') AND (g."started_at", g."id") > (f."started_at", f."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_active_conv_uq" ON "flow_runs" USING btree ("conversation_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_tenant_running_idx" ON "jobs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idem_uq" ON "tasks" USING btree ("tenant_id","idempotency_key");