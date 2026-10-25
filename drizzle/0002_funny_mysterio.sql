CREATE TABLE "segment_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"assigned_by" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "segment_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"verdict" boolean NOT NULL,
	"confidence" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_quote" text NOT NULL,
	"evidence_event_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_proposals" ADD CONSTRAINT "segment_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_proposals" ADD CONSTRAINT "segment_proposals_run_id_segment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."segment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_proposals" ADD CONSTRAINT "segment_proposals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_proposals" ADD CONSTRAINT "segment_proposals_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_proposals" ADD CONSTRAINT "segment_proposals_evidence_event_id_timeline_events_id_fk" FOREIGN KEY ("evidence_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_runs" ADD CONSTRAINT "segment_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_runs" ADD CONSTRAINT "segment_runs_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segment_membership_active" ON "segment_memberships" USING btree ("tenant_id","person_id","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_proposal_run_unique" ON "segment_proposals" USING btree ("run_id","segment_id");--> statement-breakpoint
CREATE INDEX "segment_proposal_pending" ON "segment_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "segment_runs_work" ON "segment_runs" USING btree ("status","locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_name_unique" ON "segments" USING btree ("tenant_id","name");