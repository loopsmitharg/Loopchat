CREATE TABLE "ops_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_status" text NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"detail" text
);
