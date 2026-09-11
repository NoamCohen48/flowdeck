/**
 * The API contract.
 *
 * `.docs/08-api-and-integration.md` commits to these endpoints as a *product*
 * surface: external import scripts and issue-tracker adapters code against them.
 * They are therefore defined once, in Zod, and both the request validation and the
 * OpenAPI document are derived from that — the document cannot drift from the
 * behaviour because it is not written separately.
 */
import { z } from "@hono/zod-openapi";

export const Uuid = z.string().uuid();

/**
 * Every write on a live surface reports the Postgres transaction id it committed
 * in. The browser holds its optimistic state until Electric's stream has delivered
 * that transaction, so the swap from "what I did" to "what happened" is exact.
 */
export const Txid = z.number().int();


/**
 * The metadata bag (D5). Deliberately open: priority, tags, category and a
 * reference screenshot all land here, and adding one is a configuration change
 * rather than a migration. Typing it narrowly would defeat the point.
 */
export const MetadataSchema = z.record(z.any());

export const VerdictSchema = z.enum(["pass", "fail", "minor", "skipped"]);
export const StepKindSchema = z.enum(["action", "assertion"]);
export const TemplateStatusSchema = z.enum(["active", "archived"]);
export const FlowRunStateSchema = z.enum([
  "open",
  "claimed",
  "finished",
  "abandoned",
  "released",
]);

/* ── Product ─────────────────────────────────────────────────────────── */

export const ProductSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string(),
  })
  .openapi("Product");

export const CreateProductSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
  })
  .openapi("CreateProduct");

/* ── Test ────────────────────────────────────────────────────────────────
   A test is an assertion, not a procedure (D4). Only title and expectedResult
   are structural; everything else lives in the metadata bag (D5) so adding
   priority or tags later is a configuration change rather than a migration. */

export const TestVersionSchema = z
  .object({
    id: Uuid,
    testId: Uuid,
    version: z.number().int().positive(),
    title: z.string(),
    expectedResult: z.string(),
    metadata: MetadataSchema,
    createdAt: z.string().datetime(),
    createdBy: z.string(),
  })
  .openapi("TestVersion");

export const TestSchema = z
  .object({
    id: Uuid,
    productId: Uuid,
    archived: z.boolean(),
    current: TestVersionSchema,
  })
  .openapi("Test");

export const CreateTestSchema = z
  .object({
    title: z.string().min(1),
    expectedResult: z.string().min(1),
    metadata: MetadataSchema.default({}),
  })
  .openapi("CreateTest");

/**
 * Bulk create, because importing a suite is the first thing anyone does (D29).
 * The response returns the created tests in request order, which is what lets an
 * importing script hold the mapping from its source rows to Flowdeck test IDs.
 */
export const CreateTestsSchema = z
  .object({ tests: z.array(CreateTestSchema).min(1).max(1000) })
  .openapi("CreateTests");

/** An edit creates a new version; the old one is never modified (D6). */
export const UpdateTestSchema = z
  .object({
    title: z.string().min(1).optional(),
    expectedResult: z.string().min(1).optional(),
    metadata: MetadataSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "an edit must change something",
  })
  .openapi("UpdateTest");

/* ── Coverage ────────────────────────────────────────────────────────────
   Reported, never declared (D1). During a migration this endpoint is the
   progress bar: start with everything uncovered, finish when nothing is. */

export const TestCoverageSchema = z
  .object({
    testId: Uuid,
    covered: z.boolean(),
    /** A live test marked by nothing anywhere — the red row (D2). */
    needsAttention: z.boolean(),
    templateIds: z.array(Uuid),
  })
  .openapi("TestCoverage");

export const CoverageReportSchema = z
  .object({
    productId: Uuid,
    total: z.number().int(),
    covered: z.number().int(),
    uncovered: z.number().int(),
    tests: z.array(TestCoverageSchema),
  })
  .openapi("CoverageReport");

/* ── Template, flow, step ────────────────────────────────────────────────
   A template's scope is implicit — whatever its flows mark (D1). There is
   deliberately no field in which to declare it. */

export const StepSchema = z
  .object({
    id: Uuid,
    position: z.number().int().nonnegative(),
    kind: StepKindSchema,
    text: z.string(),
    expectedResult: z.string().nullable(),
    deviceLabel: z.string(),
    marks: z.array(Uuid),
  })
  .openapi("Step");

export const CreateStepSchema = z
  .object({
    kind: StepKindSchema,
    text: z.string().min(1),
    expectedResult: z.string().nullable().default(null),
    /** Free text (D16). The first step to use a label introduces that device. */
    deviceLabel: z.string().min(1),
    marks: z.array(Uuid).default([]),
  })
  .openapi("CreateStep");

export const FlowSchema = z
  .object({
    id: Uuid,
    templateId: Uuid,
    name: z.string(),
    precondition: z.string(),
    estimatedMinutes: z.number().int().positive().nullable(),
    position: z.number().int().nonnegative(),
    steps: z.array(StepSchema),
  })
  .openapi("Flow");

export const CreateFlowSchema = z
  .object({
    name: z.string().min(1),
    /** The lightweight answer to dependencies (D22): state, not ordering. */
    precondition: z.string().default(""),
    /** Hand-typed, never derived from run history (D31). */
    estimatedMinutes: z.number().int().positive().nullable().default(null),
    steps: z.array(CreateStepSchema).default([]),
  })
  .openapi("CreateFlow");

export const TemplateSchema = z
  .object({
    id: Uuid,
    productId: Uuid,
    name: z.string(),
    description: z.string(),
    status: TemplateStatusSchema,
    flows: z.array(FlowSchema),
  })
  .openapi("Template");

export const TemplateSummarySchema = TemplateSchema.omit({ flows: true })
  .extend({
    flowCount: z.number().int(),
    /** Reported as information, never as a warning — a template covering a slice
        of the library is not deficient, that is why several exist (D1). */
    marksTestCount: z.number().int(),
  })
  .openapi("TemplateSummary");

export const CreateTemplateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    status: TemplateStatusSchema.default("active"),
    flows: z.array(CreateFlowSchema).default([]),
  })
  .openapi("CreateTemplate");

/* ── Structural editing (07 §1) ────────────────────────────────────────── */

/* ── The issue feed (08, D27, D28) ──────────────────────────────────────
   Every non-pass result, self-contained: enough context to become a ticket
   without a second lookup. Flowdeck labels; the adapter decides. */

export const IssueTypeSchema = z.enum(["failure", "minor", "invalid_test", "pass"]);

export const IssueSchema = z
  .object({
    type: IssueTypeSchema,
    test: z.object({
      id: Uuid,
      versionId: Uuid,
      version: z.number().int(),
      title: z.string(),
      expected: z.string(),
    }),
    context: z.object({
      flowId: Uuid,
      flow: z.string(),
      stepId: Uuid,
      stepNumber: z.number().int().positive(),
      stepText: z.string(),
      device: z.string(),
    }),
    note: z.string().nullable(),
    attachments: z.array(z.string()),
    blocking: z.boolean(),
    recordedBy: z.string(),
    recordedAt: z.string().datetime(),
  })
  .openapi("Issue");

export const IssueFeedSchema = z
  .object({
    run: z.object({
      id: Uuid,
      date: z.string().datetime(),
      closedAt: z.string().datetime().nullable(),
      product: z.string(),
      productId: Uuid,
      template: z.string(),
      templateId: Uuid,
    }),
    issues: z.array(IssueSchema),
  })
  .openapi("IssueFeed");

export const TestHistoryEntrySchema = z
  .object({
    runId: Uuid,
    runDate: z.string().datetime(),
    template: z.string(),
    flow: z.string(),
    version: z.number().int(),
    title: z.string(),
    expected: z.string(),
    verdict: VerdictSchema,
    note: z.string().nullable(),
    blocking: z.boolean(),
    recordedBy: z.string(),
    recordedAt: z.string().datetime(),
  })
  .openapi("TestHistoryEntry");

export const UpdateTemplateSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: TemplateStatusSchema.optional(),
  })
  .openapi("UpdateTemplate");

export const UpdateFlowSchema = z
  .object({
    name: z.string().min(1).optional(),
    precondition: z.string().optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
  })
  .openapi("UpdateFlow");

export const InsertStepSchema = CreateStepSchema.extend({
  /** Index the new step takes; what was there moves down. Past the end appends. */
  position: z.number().int().nonnegative(),
}).openapi("InsertStep");

export const UpdateStepSchema = z
  .object({
    kind: StepKindSchema.optional(),
    text: z.string().min(1).optional(),
    expectedResult: z.string().nullable().optional(),
    deviceLabel: z.string().min(1).optional(),
    /** Replaces the step's marks when present. */
    marks: z.array(Uuid).optional(),
  })
  .openapi("UpdateStep");

export const ReorderSchema = z
  .object({ ids: z.array(Uuid).min(1) })
  .openapi("Reorder");

export const StepWriteSchema = z
  .object({ step: StepSchema, txid: Txid })
  .openapi("StepWrite");

export const TxidSchema = z.object({ txid: Txid }).openapi("TxidResponse");

export const TestUsageSchema = z
  .object({
    stepId: Uuid,
    stepText: z.string(),
    stepIndex: z.number().int(),
    deviceLabel: z.string(),
    flowId: Uuid,
    flowName: z.string(),
    templateId: Uuid,
    templateName: z.string(),
    templateStatus: TemplateStatusSchema,
  })
  .openapi("TestUsage");

export const CreateTemplatesSchema = z
  .object({ templates: z.array(CreateTemplateSchema).min(1).max(200) })
  .openapi("CreateTemplates");

/* ── Bundle import ───────────────────────────────────────────────────────
   The two-phase import (tests, then templates marking the returned IDs) is the
   contract; this is the one-request form of it for a script that has the whole
   suite in hand. Tests carry a caller-chosen `key`, steps mark by that key, and
   the mapping the script would otherwise have to hold is resolved server-side,
   inside one transaction — either everything lands or nothing does. */

/** A caller-chosen handle for a test within one bundle: a spreadsheet row, a Jira key. */
export const BundleKey = z.string().min(1).max(200);

export const BundleTestSchema = CreateTestSchema.extend({
  key: BundleKey,
}).openapi("BundleTest");

export const BundleStepSchema = CreateStepSchema.extend({
  /** Keys of tests in this bundle, or ids of tests that already exist in the product. */
  marks: z.array(z.string().min(1)).default([]),
}).openapi("BundleStep");

export const BundleFlowSchema = CreateFlowSchema.extend({
  steps: z.array(BundleStepSchema).default([]),
}).openapi("BundleFlow");

export const BundleTemplateSchema = CreateTemplateSchema.extend({
  flows: z.array(BundleFlowSchema).default([]),
}).openapi("BundleTemplate");

export const ImportBundleSchema = z
  .object({
    tests: z.array(BundleTestSchema).max(1000).default([]),
    templates: z.array(BundleTemplateSchema).max(200).default([]),
  })
  .refine((b) => b.tests.length > 0 || b.templates.length > 0, {
    message: "a bundle must contain at least one test or template",
  })
  .openapi("ImportBundle");

export const ImportResultSchema = z
  .object({
    /** Bundle key → the created test's id, for the script's own records. */
    keys: z.record(Uuid),
    tests: z.array(TestSchema),
    templates: z.array(TemplateSchema),
  })
  .openapi("ImportResult");

export type ImportBundleInput = z.infer<typeof ImportBundleSchema>;

/* ── Errors ──────────────────────────────────────────────────────────── */

export const ErrorSchema = z
  .object({
    error: z.string(),
    /** Present when the failure is a field-level validation problem. */
    details: z.any().optional(),
  })
  .openapi("Error");

export type CreateTestInput = z.infer<typeof CreateTestSchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

/* ── Runs and execution ──────────────────────────────────────────────────
   The template is the class; the run is the object (D8). */

export const SnapshotStepSchema = StepSchema;
export const SnapshotFlowSchema = z.object({
  id: Uuid,
  name: z.string(),
  precondition: z.string(),
  estimatedMinutes: z.number().int().nullable(),
  position: z.number().int(),
  steps: z.array(SnapshotStepSchema),
});
export const SnapshotTestSchema = z.object({
  id: Uuid,
  versionId: Uuid,
  title: z.string(),
  expectedResult: z.string(),
});
export const TemplateSnapshotSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string(),
    takenAt: z.string(),
    flows: z.array(SnapshotFlowSchema),
    tests: z.array(SnapshotTestSchema),
  })
  .openapi("TemplateSnapshot");

export const FlowRunSchema = z
  .object({
    id: Uuid,
    txid: Txid.optional(),
    runId: Uuid,
    flowId: Uuid,
    claimedBy: z.string().nullable(),
    state: FlowRunStateSchema,
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi("FlowRun");

export const AttachmentSchema = z
  .object({
    id: Uuid,
    testResultId: Uuid,
    mime: z.string(),
    bytes: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    originalName: z.string().nullable(),
    url: z.string(),
  })
  .openapi("Attachment");

export const TestResultSchema = z
  .object({
    id: Uuid,
    txid: Txid.optional(),
    flowRunId: Uuid,
    stepId: Uuid,
    testId: Uuid,
    testVersionId: Uuid,
    verdict: VerdictSchema,
    note: z.string().nullable(),
    blocking: z.boolean(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TestResult");

export const RunSummarySchema = z
  .object({
    id: Uuid,
    templateId: Uuid,
    templateName: z.string(),
    date: z.string(),
    startedBy: z.string(),
    closedAt: z.string().nullable(),
  })
  .openapi("RunSummary");

export const RunSchema = z
  .object({
    id: Uuid,
    templateId: Uuid,
    date: z.string(),
    startedBy: z.string(),
    closedAt: z.string().nullable(),
    snapshot: TemplateSnapshotSchema,
    flowRuns: z.array(FlowRunSchema),
    results: z.array(TestResultSchema),
  })
  .openapi("Run");

/**
 * Recording a verdict (D12, D13, D36). Per test, not per step. The note rule
 * is enforced here and again by a CHECK constraint, so no path can record a
 * bug report with no description.
 */
export const RecordResultSchema = z
  .object({
    stepId: Uuid,
    testId: Uuid,
    verdict: VerdictSchema,
    note: z.string().trim().nullable().default(null),
    /** Only meaningful with `fail`: does this wedge the rest of the flow? (D11) */
    blocking: z.boolean().default(false),
    /** Client-generated. The same key twice records once. */
    idempotencyKey: z.string().min(8).max(200),
  })
  .superRefine((v, ctx) => {
    if ((v.verdict === "fail" || v.verdict === "skipped") && !v.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message:
          v.verdict === "fail"
            ? "Say what went wrong — a failure without a description is not actionable."
            : "Say what is wrong with the test — skipped is how the suite gets fixed.",
      });
    }
    if (v.blocking && v.verdict !== "fail") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocking"],
        message: "Only a failure can block the rest of a flow.",
      });
    }
  })
  .openapi("RecordResult");

/** "Pass all" on a step: every test the step marks, passed, in one request. */
export const PassAllSchema = z
  .object({
    stepId: Uuid,
    /** One key per test, so a double-tap on the button still records once each. */
    idempotencyKeyPrefix: z.string().min(8).max(160),
  })
  .openapi("PassAll");

export const ClaimResponseSchema = z
  .object({
    flowRun: FlowRunSchema,
    txid: Txid,
    /** Other testers already on this flow — what the confirmation shows (D26). */
    alsoRunning: z.array(FlowRunSchema),
  })
  .openapi("ClaimResponse");

export const MeSchema = z
  .object({ name: z.string().nullable() })
  .openapi("Me");

export const PresenceSchema = z
  .object({
    scope: z.string().regex(/^(run|flow|template):[0-9a-f-]{36}$/i),
  })
  .openapi("Presence");
