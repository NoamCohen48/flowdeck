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

export const CreateTemplatesSchema = z
  .object({ templates: z.array(CreateTemplateSchema).min(1).max(200) })
  .openapi("CreateTemplates");

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
