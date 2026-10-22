CREATE TABLE "bot_team_members" (
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	CONSTRAINT "bot_team_members_team_id_bot_id_pk" PRIMARY KEY("team_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE "bot_team_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"bot_versions" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"channel_connection_id" uuid,
	"status" text DEFAULT 'inactive' NOT NULL,
	"draft_graph" jsonb NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"team_id" uuid,
	"team_version_id" uuid,
	"from_bot_id" uuid,
	"to_bot_id" uuid,
	"to_human" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"intent" text,
	"reason" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "role" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "team_version_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "active_bot_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "product_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_team_members" ADD CONSTRAINT "bot_team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_team_members" ADD CONSTRAINT "bot_team_members_team_id_bot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."bot_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_team_members" ADD CONSTRAINT "bot_team_members_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_team_versions" ADD CONSTRAINT "bot_team_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_team_versions" ADD CONSTRAINT "bot_team_versions_team_id_bot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."bot_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_team_versions" ADD CONSTRAINT "bot_team_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_teams" ADD CONSTRAINT "bot_teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_teams" ADD CONSTRAINT "bot_teams_channel_connection_id_channel_connections_id_fk" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_transfers" ADD CONSTRAINT "bot_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_transfers" ADD CONSTRAINT "bot_transfers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_transfers" ADD CONSTRAINT "bot_transfers_team_id_bot_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."bot_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_transfers" ADD CONSTRAINT "bot_transfers_from_bot_id_bots_id_fk" FOREIGN KEY ("from_bot_id") REFERENCES "public"."bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_transfers" ADD CONSTRAINT "bot_transfers_to_bot_id_bots_id_fk" FOREIGN KEY ("to_bot_id") REFERENCES "public"."bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_team_members_bot_idx" ON "bot_team_members" USING btree ("bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_team_versions_uq" ON "bot_team_versions" USING btree ("team_id","version");--> statement-breakpoint
CREATE INDEX "bot_teams_tenant_idx" ON "bot_teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "bot_transfers_conv_idx" ON "bot_transfers" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_transfers_team_idx" ON "bot_transfers" USING btree ("team_id","created_at");