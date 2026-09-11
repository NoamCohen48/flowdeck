/**
 * The test library.
 *
 * A test is an assertion with no steps (D4), immutable at the version level and
 * stable at the identity level (D6). Every route here follows from those two facts:
 * an edit is a POST of a new version in disguise, and a delete is an archive.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { summarizeCoverage } from "@flowdeck/domain";
import {
  coverageForProduct,
  createTestVersion,
  createTests,
  getProduct,
  getTest,
  listTestVersions,
  listTests,
  markCountFor,
  setArchived,
} from "../../db/queries.ts";
import {
  CoverageReportSchema,
  CreateTestsSchema,
  ErrorSchema,
  TestSchema,
  TestVersionSchema,
  UpdateTestSchema,
  Uuid,
} from "../schemas.ts";
import { testDto, testVersionDto } from "../serialize.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const tests = createRouter();

/* ── Reads ───────────────────────────────────────────────────────────── */

tests.openapi(
  createRoute({
    method: "get",
    path: "/products/{productId}/tests",
    tags: ["Tests"],
    summary: "List a product's tests",
    description:
      "A flat searchable list. The feature-table grouping that mattered in a document is replaced by search and tags.",
    request: {
      params: z.object({ productId: Uuid }),
      query: z.object({
        includeArchived: z.enum(["true", "false"]).default("false"),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TestSchema) } },
        description: "The library",
      },
    },
  }),
  async (c) => {
    const { productId } = c.req.valid("param");
    const { includeArchived } = c.req.valid("query");
    const rows = await listTests(productId);
    const visible = includeArchived === "true" ? rows : rows.filter((r) => !r.archived);
    return c.json(visible.map(testDto), 200);
  },
);

tests.openapi(
  createRoute({
    method: "get",
    path: "/tests/{testId}",
    tags: ["Tests"],
    summary: "Get a test at its current version",
    request: { params: z.object({ testId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: TestSchema } },
        description: "The test",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such test",
      },
    },
  }),
  async (c) => {
    const row = await getTest(c.req.valid("param").testId);
    return row ? c.json(testDto(row), 200) : c.json({ error: "no such test" }, 404);
  },
);

tests.openapi(
  createRoute({
    method: "get",
    path: "/tests/{testId}/versions",
    tags: ["Tests"],
    summary: "Every version of a test, oldest first",
    description:
      "The old version is never modified and never deleted, so a result recorded in March stays readable against March's wording after six edits (D6).",
    request: { params: z.object({ testId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TestVersionSchema) } },
        description: "Version history",
      },
    },
  }),
  async (c) => {
    const rows = await listTestVersions(c.req.valid("param").testId);
    return c.json(rows.map(testVersionDto), 200);
  },
);

/* ── Coverage ────────────────────────────────────────────────────────────
   Computed across every template of the product, not per template (D1): a
   template targeting one setup can only reach a slice of the library, so a
   per-template warning would fire constantly and mean nothing. */

tests.openapi(
  createRoute({
    method: "get",
    path: "/products/{productId}/coverage",
    tags: ["Tests", "Coverage"],
    summary: "Coverage state for every test in a product",
    description:
      "During a migration this is the progress bar: start with everything uncovered, finish when nothing is.",
    request: { params: z.object({ productId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: CoverageReportSchema } },
        description: "Coverage per test, plus the totals",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such product",
      },
    },
  }),
  async (c) => {
    const { productId } = c.req.valid("param");
    if (!(await getProduct(productId))) {
      return c.json({ error: "no such product" }, 404);
    }

    const rows = await coverageForProduct(productId);
    // The summary comes from @flowdeck/domain rather than being recomputed in SQL,
    // so the API and the browser agree on what "covers 20 of 25" means.
    const summary = summarizeCoverage(
      rows.map((r) => ({
        testId: r.test_id,
        archived: r.archived,
        markedByTemplateIds: r.template_ids ?? [],
      })),
    );

    return c.json(
      {
        productId,
        ...summary,
        tests: rows.map((r) => ({
          testId: r.test_id,
          covered: r.covered,
          needsAttention: r.needs_attention,
          templateIds: r.template_ids ?? [],
        })),
      },
      200,
    );
  },
);

/* ── Writes ──────────────────────────────────────────────────────────── */

tests.openapi(
  createRoute({
    method: "post",
    path: "/products/{productId}/tests",
    tags: ["Tests"],
    summary: "Bulk-create tests",
    description:
      "Returns the created tests in request order, which is what lets an importing script hold the mapping from its source rows to Flowdeck IDs (D29). Import is knowingly not idempotent: running a parser twice creates everything twice.",
    request: {
      params: z.object({ productId: Uuid }),
      body: { content: { "application/json": { schema: CreateTestsSchema } } },
    },
    responses: {
      201: {
        content: { "application/json": { schema: z.array(TestSchema) } },
        description: "The created tests, in request order",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No identity on the request",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such product",
      },
    },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { productId } = c.req.valid("param");
    if (!(await getProduct(productId))) {
      return c.json({ error: "no such product" }, 404);
    }

    const created = await createTests(
      productId,
      c.req.valid("json").tests,
      actor,
    );
    const rows = await Promise.all(created.map((t) => getTest(t.id)));
    return c.json(
      rows.filter((r) => r !== undefined).map(testDto),
      201,
    );
  },
);

tests.openapi(
  createRoute({
    method: "patch",
    path: "/tests/{testId}",
    tags: ["Tests"],
    summary: "Edit a test — creates a new version",
    description:
      "The old version is never modified. Flows reference the test ID, so nothing needs repointing; that is the whole reason identity and versioning are separate (D6).",
    request: {
      params: z.object({ testId: Uuid }),
      body: { content: { "application/json": { schema: UpdateTestSchema } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TestSchema } },
        description: "The test at its new version",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No identity on the request",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such test",
      },
    },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { testId } = c.req.valid("param");
    const next = await createTestVersion(testId, c.req.valid("json"), actor);
    if (!next) return c.json({ error: "no such test" }, 404);
    return c.json(testDto((await getTest(testId))!), 200);
  },
);

const ArchiveResponseSchema = z.object({
  test: TestSchema,
  /** What the confirmation dialog needs in order to state the consequence (D24). */
  marks: z.object({
    steps: z.number().int(),
    flows: z.number().int(),
    templates: z.number().int(),
  }),
});

tests.openapi(
  createRoute({
    method: "post",
    path: "/tests/{testId}/archive",
    tags: ["Tests"],
    summary: "Archive a test",
    description:
      "Archiving stops the test counting toward coverage; existing marks render as 'archived test' and historical runs stay intact. Hard deletion is never offered — a test referenced in six flows and three runs cannot be safely erased (D7).",
    request: {
      params: z.object({ testId: Uuid }),
      query: z.object({ undo: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ArchiveResponseSchema } },
        description: "The archived test, and how many places marked it",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No identity on the request",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such test",
      },
    },
  }),
  async (c) => {
    requireActor(c);
    const { testId } = c.req.valid("param");
    const { undo } = c.req.valid("query");

    const marks = await markCountFor(testId);
    const updated = await setArchived(testId, undo !== "true");
    if (!updated) return c.json({ error: "no such test" }, 404);

    return c.json({ test: testDto((await getTest(testId))!), marks }, 200);
  },
);
