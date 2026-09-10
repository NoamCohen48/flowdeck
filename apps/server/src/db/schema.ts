/**
 * Flowdeck schema. Follows `.docs/01-domain-model.md`; see `.docs/09-implementation-plan.md`
 * for why the shapes are what they are.
 *
 * Two conventions worth knowing before reading:
 *
 * 1. **Text columns with CHECK constraints rather than Postgres enums.** Electric syncs
 *    these rows to the browser, and a plain text column has an unambiguous wire
 *    representation. The TypeScript union types come from `@flowdeck/domain`, so the
 *    values are still closed at the type level.
 *
 * 2. **Nothing derived is stored.** Coverage is a view, device hand-offs are computed
 *    in `@flowdeck/domain`, and worst-result-wins is a query. A stored derivation is a
 *    stale derivation waiting to happen — `07-open-items.md` warns about exactly this.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  FlowRunState,
  StepKind,
  TemplateStatus,
  Verdict,
} from "@flowdeck/domain";

const id = () => uuid("id").primaryKey().defaultRandom();
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ── Product ─────────────────────────────────────────────────────────────
   Fully independent (D23). Everything else lives under exactly one product. */

export const product = pgTable("product", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: now(),
});

/* ── Test ────────────────────────────────────────────────────────────────
   An assertion, not a procedure (D4). Stable identity, immutable versions (D6):
   flows reference `test.id` and always resolve to the current version, while a
   result pins the exact `test_version.id` it was executed against. */

export const test = pgTable(
  "test",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    // Nullable only for the instant between inserting a test and its first version.
    currentVersionId: uuid("current_version_id"),
    // Deletion archives; it never erases (D7).
    archived: boolean("archived").notNull().default(false),
    createdAt: now(),
  },
  (t) => [index("test_product_idx").on(t.productId)],
);

export const testVersion = pgTable(
  "test_version",
  {
    id: id(),
    testId: uuid("test_id")
      .notNull()
      .references(() => test.id, { onDelete: "cascade" }),
    /** 1-based, per test. Shown in the UI as "Editing creates version 7". */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    expectedResult: text("expected_result").notNull(),
    /** Deliberately generic (D5): priority, tags, category, reference screenshots.
        Adding a field is a configuration change, not a migration. */
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    uniqueIndex("test_version_unique").on(t.testId, t.version),
    index("test_version_test_idx").on(t.testId),
  ],
);

/* ── Template ────────────────────────────────────────────────────────────
   A reusable definition of a testing day for one setup. Scope is implicit —
   whatever its flows mark (D1). Archived templates still count for coverage (D3). */

export const template = pgTable(
  "template",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<TemplateStatus>().notNull().default("active"),
    createdAt: now(),
  },
  (t) => [
    index("template_product_idx").on(t.productId),
    check("template_status_check", sql`${t.status} in ('active','archived')`),
  ],
);

/* ── Flow ────────────────────────────────────────────────────────────────
   One continuous human path. Unordered and independent within a template (D22):
   setup requirements are free-text preconditions, never enforced dependencies,
   because a real dependency graph serialises seven people. */

export const flow = pgTable(
  "flow",
  {
    id: id(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    precondition: text("precondition").notNull().default(""),
    /** Hand-typed and optional; never derived from run history (D31). */
    estimatedMinutes: integer("estimated_minutes"),
    /** Display order within the template only. */
    position: integer("position").notNull(),
    createdAt: now(),
  },
  (t) => [index("flow_template_idx").on(t.templateId)],
);

/* ── Step ────────────────────────────────────────────────────────────────
   Order is meaningful — this is a sequence, not a set. `updated_at` supports
   last-write-wins between two authors on the same step (D37). */

export const step = pgTable(
  "step",
  {
    id: id(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flow.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").$type<StepKind>().notNull(),
    text: text("text").notNull(),
    /** Shown for assertions only. The asymmetry is informative: an expected
        result appearing means "stop and look". */
    expectedResult: text("expected_result"),
    /** Free text (D16). The step that first uses a label introduces that device;
        that fact is computed, never stored — see `computeHandoffs`. */
    deviceLabel: text("device_label").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("step_flow_idx").on(t.flowId, t.position),
    check("step_kind_check", sql`${t.kind} in ('action','assertion')`),
  ],
);

/* ── step_mark ───────────────────────────────────────────────────────────
   The many-to-many join that the Confluence document never made. Zero marks is
   normal (navigation steps verify nothing); several is normal; the same test
   marked in many flows is allowed and unrestricted (D19). */

export const stepMark = pgTable(
  "step_mark",
  {
    stepId: uuid("step_id")
      .notNull()
      .references(() => step.id, { onDelete: "cascade" }),
    testId: uuid("test_id")
      .notNull()
      .references(() => test.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.stepId, t.testId] }),
    index("step_mark_test_idx").on(t.testId),
  ],
);

/* ── Run ─────────────────────────────────────────────────────────────────
   The template is the class; the run is the object (D8). A run pins a snapshot
   at start (D21) so an edit mid-day cannot reshuffle the checklist of a tester
   on step 14, and stays open indefinitely across sittings (D25). */

export const run = pgTable(
  "run",
  {
    id: id(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "restrict" }),
    date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
    /** Frozen copy of the template, its flows, steps and marks, taken at start.
        A run reads its checklist from here, never from the live template. */
    templateSnapshot: jsonb("template_snapshot").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    startedBy: text("started_by").notNull(),
  },
  (t) => [index("run_template_idx").on(t.templateId)],
);

/* ── FlowRun ─────────────────────────────────────────────────────────────
   Per tester, not per flow (D26). Two people may run the same flow in the same
   run and each produces an independent set of results; neither overwrites the
   other, and worst-result-wins resolves any disagreement at no extra cost. */

export const flowRun = pgTable(
  "flow_run",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    /** References the flow in the snapshot, so it survives the flow being edited. */
    flowId: uuid("flow_id").notNull(),
    /** Claims are advisory, not exclusive (D26) — this records who, not a lock. */
    claimedBy: text("claimed_by"),
    state: text("state").$type<FlowRunState>().notNull().default("open"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("flow_run_run_idx").on(t.runId),
    check(
      "flow_run_state_check",
      sql`${t.state} in ('open','claimed','finished','abandoned','released')`,
    ),
  ],
);

/* ── TestResult ──────────────────────────────────────────────────────────
   Recorded per test, not per step (D12): one step marking three tests can
   produce two passes and a failure, and a per-step verdict cannot say that. */

export const testResult = pgTable(
  "test_result",
  {
    id: id(),
    flowRunId: uuid("flow_run_id")
      .notNull()
      .references(() => flowRun.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").notNull(),
    testId: uuid("test_id")
      .notNull()
      .references(() => test.id, { onDelete: "cascade" }),
    /** Pinned at execution (D6). March's result stays readable against March's
        wording even after six edits. */
    testVersionId: uuid("test_version_id")
      .notNull()
      .references(() => testVersion.id, { onDelete: "restrict" }),
    verdict: text("verdict").$type<Verdict>().notNull(),
    /** Required for fail and skipped; optional for minor (D13). Enforced by the
        API against `verdictRequiresNote`, and by the CHECK below. */
    note: text("note"),
    /** Only meaningful for fail: did this wedge the rest of the flow? (D11) */
    blocking: boolean("blocking").notNull().default(false),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** A tired tester taps the tick twice (D36). One column, one unique index. */
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("test_result_idempotency").on(t.idempotencyKey),
    index("test_result_flow_run_idx").on(t.flowRunId),
    index("test_result_test_idx").on(t.testId),
    check(
      "test_result_verdict_check",
      sql`${t.verdict} in ('pass','fail','minor','skipped')`,
    ),
    check(
      "test_result_note_required",
      sql`${t.verdict} not in ('fail','skipped') or (${t.note} is not null and length(btrim(${t.note})) > 0)`,
    ),
    check(
      "test_result_blocking_only_on_fail",
      sql`${t.blocking} = false or ${t.verdict} = 'fail'`,
    ),
  ],
);

/* ── Attachment ──────────────────────────────────────────────────────────
   Metadata only; the bytes are content-addressed on a mounted volume and served
   by the API. Large binaries stay out of Postgres and out of the replication
   stream Electric follows. */

export const attachment = pgTable(
  "attachment",
  {
    id: id(),
    testResultId: uuid("test_result_id")
      .notNull()
      .references(() => testResult.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    originalName: text("original_name"),
    createdAt: now(),
  },
  (t) => [index("attachment_result_idx").on(t.testResultId)],
);

/* ── Presence ────────────────────────────────────────────────────────────
   "Dana is editing this flow", "Ori is on this run". Synced as a shape, swept
   by TTL. The cheapest possible presence given Electric is already there (D37). */

export const presence = pgTable(
  "presence",
  {
    actor: text("actor").notNull(),
    /** e.g. `run:<uuid>` or `flow:<uuid>`. */
    scope: text("scope").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.actor, t.scope] }),
    index("presence_scope_idx").on(t.scope),
  ],
);

/** Every name that has ever identified itself, so the picker can offer them (D38). */
export const actor = pgTable("actor", {
  name: text("name").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
