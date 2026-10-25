CREATE TABLE "line_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"event_id" text NOT NULL,
	"source_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"line_event_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_line_event_id_unique" UNIQUE("line_event_id")
);
--> statement-breakpoint
ALTER TABLE "timeline_events" ADD COLUMN "line_event_id" uuid;--> statement-breakpoint
ALTER TABLE "line_events" ADD CONSTRAINT "line_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_events" ADD CONSTRAINT "line_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_line_event_id_line_events_id_fk" FOREIGN KEY ("line_event_id") REFERENCES "public"."line_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_event_unique" ON "line_events" USING btree ("tenant_id","destination","event_id");--> statement-breakpoint
CREATE INDEX "line_event_work" ON "line_events" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "tasks_tenant_status" ON "tasks" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_line_event_id_unique" UNIQUE("line_event_id");