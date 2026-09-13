CREATE TABLE "step_problem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"note" text NOT NULL,
	"workaround" text,
	"blocking" boolean DEFAULT false NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_problem_note_required" CHECK (length(btrim("step_problem"."note")) > 0),
	CONSTRAINT "step_problem_workaround_or_blocked" CHECK ("step_problem"."blocking" or ("step_problem"."workaround" is not null and length(btrim("step_problem"."workaround")) > 0))
);
--> statement-breakpoint
ALTER TABLE "step" ADD COLUMN "post_state" text;--> statement-breakpoint
ALTER TABLE "step_problem" ADD CONSTRAINT "step_problem_flow_run_id_flow_run_id_fk" FOREIGN KEY ("flow_run_id") REFERENCES "public"."flow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "step_problem_once_per_step" ON "step_problem" USING btree ("flow_run_id","step_id");