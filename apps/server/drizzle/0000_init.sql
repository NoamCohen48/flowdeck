CREATE TABLE "actor" (
	"name" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_result_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"precondition" text DEFAULT '' NOT NULL,
	"estimated_minutes" integer,
	"position" integer NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"claimed_by" text,
	"state" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"progress" jsonb,
	CONSTRAINT "flow_run_state_check" CHECK ("flow_run"."state" in ('open','claimed','finished','abandoned','released'))
);
--> statement-breakpoint
CREATE TABLE "presence" (
	"actor" text NOT NULL,
	"scope" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_actor_scope_pk" PRIMARY KEY("actor","scope")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"started_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"expected_result" text,
	"post_state" text,
	"device_label" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_kind_check" CHECK ("step"."kind" in ('action','assertion'))
);
--> statement-breakpoint
CREATE TABLE "step_mark" (
	"step_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	CONSTRAINT "step_mark_step_id_test_id_pk" PRIMARY KEY("step_id","test_id")
);
--> statement-breakpoint
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
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_status_check" CHECK ("template"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"current_version_id" uuid,
	"key" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"test_version_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"blocking" boolean DEFAULT false NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "test_result_verdict_check" CHECK ("test_result"."verdict" in ('pass','fail','minor','skipped')),
	CONSTRAINT "test_result_note_required" CHECK ("test_result"."verdict" not in ('fail','skipped') or ("test_result"."note" is not null and length(btrim("test_result"."note")) > 0)),
	CONSTRAINT "test_result_blocking_only_on_fail" CHECK ("test_result"."blocking" = false or "test_result"."verdict" = 'fail')
);
--> statement-breakpoint
CREATE TABLE "test_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"expected_result" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_test_result_id_test_result_id_fk" FOREIGN KEY ("test_result_id") REFERENCES "public"."test_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_run" ADD CONSTRAINT "flow_run_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_mark" ADD CONSTRAINT "step_mark_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_mark" ADD CONSTRAINT "step_mark_test_id_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_problem" ADD CONSTRAINT "step_problem_flow_run_id_flow_run_id_fk" FOREIGN KEY ("flow_run_id") REFERENCES "public"."flow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test" ADD CONSTRAINT "test_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_flow_run_id_flow_run_id_fk" FOREIGN KEY ("flow_run_id") REFERENCES "public"."flow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_test_id_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_test_version_id_test_version_id_fk" FOREIGN KEY ("test_version_id") REFERENCES "public"."test_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_version" ADD CONSTRAINT "test_version_test_id_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_result_idx" ON "attachment" USING btree ("test_result_id");--> statement-breakpoint
CREATE INDEX "flow_template_idx" ON "flow" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_key_unique" ON "flow" USING btree ("template_id","key");--> statement-breakpoint
CREATE INDEX "flow_run_run_idx" ON "flow_run" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "presence_scope_idx" ON "presence" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_unique" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "run_template_idx" ON "run" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "step_flow_idx" ON "step" USING btree ("flow_id","position");--> statement-breakpoint
CREATE INDEX "step_mark_test_idx" ON "step_mark" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_problem_once_per_step" ON "step_problem" USING btree ("flow_run_id","step_id");--> statement-breakpoint
CREATE INDEX "template_product_idx" ON "template" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_key_unique" ON "template" USING btree ("product_id","key");--> statement-breakpoint
CREATE INDEX "test_product_idx" ON "test" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_key_unique" ON "test" USING btree ("product_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "test_result_idempotency" ON "test_result" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "test_result_flow_run_idx" ON "test_result" USING btree ("flow_run_id");--> statement-breakpoint
CREATE INDEX "test_result_test_idx" ON "test_result" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_version_unique" ON "test_version" USING btree ("test_id","version");--> statement-breakpoint
CREATE INDEX "test_version_test_idx" ON "test_version" USING btree ("test_id");