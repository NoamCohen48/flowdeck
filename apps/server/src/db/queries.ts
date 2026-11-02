/**
 * Reads and writes that more than one route needs. Anything used once stays in
 * its route; this file is for the shapes that would otherwise be written twice
 * and drift.
 */
import { and, asc, eq, inArray, sql as raw } from "drizzle-orm";
import { db, query } from "./client.ts";
import {
  flow,
  product,
  step,
  stepMark,
  template,
  test,
  testVersion,
} from "./schema.ts";
import type { CreateTemplateInput, CreateTestInput } from "../http/schemas.ts";
import { assignKey } from "./keys.ts";

/* ── Tests ───────────────────────────────────────────────────────────── */

/** A test plus its current version, which is the only form the UI ever wants. */
export const testWithCurrentVersion = {
  id: test.id,
  productId: test.productId,
  key: test.key,
  archived: test.archived,
  current: {
    id: testVersion.id,
    testId: testVersion.testId,
    version: testVersion.version,
    title: testVersion.title,
    expectedResult: testVersion.expectedResult,
    metadata: testVersion.metadata,
    createdAt: testVersion.createdAt,
    createdBy: testVersion.createdBy,
  },
};

export async function listTests(productId: string) {
  return db
    .select(testWithCurrentVersion)
    .from(test)
    .innerJoin(testVersion, eq(testVersion.id, test.currentVersionId))
    .where(eq(test.productId, productId))
    .orderBy(asc(testVersion.title));
}

export async function getTest(testId: string) {
  const [row] = await db
    .select(testWithCurrentVersion)
    .from(test)
    .innerJoin(testVersion, eq(testVersion.id, test.currentVersionId))
    .where(eq(test.id, testId));
  return row;
}

export async function listTestVersions(testId: string) {
  return db
    .select()
    .from(testVersion)
    .where(eq(testVersion.testId, testId))
    .orderBy(asc(testVersion.version));
}

/**
 * Bulk create in one transaction, returning tests in request order so an importing
 * script can hold the mapping from its source rows to Flowdeck IDs.
 *
 * Import is knowingly not idempotent: running a parser twice creates everything
 * twice and Flowdeck cannot tell. The accepted answer during migration is
 * wipe-and-reimport; `externalId` remains addable later as an optional field.
 */
export async function createTests(
  productId: string,
  inputs: CreateTestInput[],
  createdBy: string,
) {
  return db.transaction((tx) => createTestsIn(tx, productId, inputs, createdBy));
}

/** A transaction handle, so the bundle import can create tests and templates atomically. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createTestsIn(
  tx: Tx,
  productId: string,
  inputs: CreateTestInput[],
  createdBy: string,
) {
  const created: { id: string; versionId: string }[] = [];
  for (const input of inputs) {
    const key = await assignKey(tx, { table: "test", productId }, input.title, input.key);
    const [t] = await tx.insert(test).values({ productId, key, archived: input.archived ?? false }).returning();
    const [v] = await tx
      .insert(testVersion)
      .values({
        testId: t!.id,
        version: 1,
        title: input.title,
        expectedResult: input.expectedResult,
        metadata: input.metadata,
        createdBy,
      })
      .returning();
    await tx
      .update(test)
      .set({ currentVersionId: v!.id })
      .where(eq(test.id, t!.id));
    created.push({ id: t!.id, versionId: v!.id });
  }
  return created;
}

/**
 * Editing creates a new version; the old one is never modified and never deleted.
 * Flows reference the test ID, so nothing needs repointing — the reason the
 * two-level split exists rather than "an edit makes a new test".
 */
export async function createTestVersion(
  testId: string,
  patch: { title?: string; expectedResult?: string; metadata?: Record<string, unknown> },
  createdBy: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(testVersion)
      .innerJoin(test, eq(test.currentVersionId, testVersion.id))
      .where(eq(test.id, testId));
    if (!current) return undefined;

    const previous = current.test_version;
    const [next] = await tx
      .insert(testVersion)
      .values({
        testId,
        version: previous.version + 1,
        title: patch.title ?? previous.title,
        expectedResult: patch.expectedResult ?? previous.expectedResult,
        metadata: patch.metadata ?? (previous.metadata as Record<string, unknown>),
        createdBy,
      })
      .returning();

    await tx
      .update(test)
      .set({ currentVersionId: next!.id })
      .where(eq(test.id, testId));
    return next;
  });
}

/* ── Coverage ────────────────────────────────────────────────────────────
   Read from the `test_coverage` view, so there is exactly one definition of
   what covered means and it cannot go stale. */

export type CoverageRow = {
  test_id: string;
  covered: boolean;
  needs_attention: boolean;
  archived: boolean;
  template_ids: string[] | null;
};

export function coverageForProduct(productId: string) {
  return query<CoverageRow>(raw`
    select test_id, covered, needs_attention, archived, template_ids
    from test_coverage
    where product_id = ${productId}
  `);
}

/* ── Templates ───────────────────────────────────────────────────────── */

export async function getTemplateWithFlows(templateId: string) {
  const [tpl] = await db.select().from(template).where(eq(template.id, templateId));
  if (!tpl) return undefined;

  const flows = await db
    .select()
    .from(flow)
    .where(eq(flow.templateId, templateId))
    .orderBy(asc(flow.position));

  const flowIds = flows.map((f) => f.id);
  const steps = flowIds.length
    ? await db
        .select()
        .from(step)
        .where(inArray(step.flowId, flowIds))
        .orderBy(asc(step.position))
    : [];

  const stepIds = steps.map((s) => s.id);
  const marks = stepIds.length
    ? await db.select().from(stepMark).where(inArray(stepMark.stepId, stepIds))
    : [];

  const marksByStep = new Map<string, string[]>();
  for (const m of marks) {
    const list = marksByStep.get(m.stepId) ?? [];
    list.push(m.testId);
    marksByStep.set(m.stepId, list);
  }

  return {
    ...tpl,
    flows: flows.map((f) => ({
      ...f,
      steps: steps
        .filter((s) => s.flowId === f.id)
        .map((s) => ({ ...s, marks: marksByStep.get(s.id) ?? [] })),
    })),
  };
}

/** Every template of a product, each with its flows and steps — the export. */
export async function listTemplatesWithFlows(productId: string) {
  const rows = await db.select({ id: template.id }).from(template).where(eq(template.productId, productId)).orderBy(asc(template.createdAt));
  const out = [];
  for (const r of rows) {
    const t = await getTemplateWithFlows(r.id);
    if (t) out.push(t);
  }
  return out;
}

/** One flow with its steps and marks, or undefined. */
export async function getFlowWithSteps(flowId: string) {
  const [f] = await db.select().from(flow).where(eq(flow.id, flowId));
  if (!f) return undefined;
  const steps = await db.select().from(step).where(eq(step.flowId, flowId)).orderBy(asc(step.position));
  const stepIds = steps.map((s) => s.id);
  const marks = stepIds.length ? await db.select().from(stepMark).where(inArray(stepMark.stepId, stepIds)) : [];
  return { ...f, steps: steps.map((s) => ({ ...s, marks: marks.filter((m) => m.stepId === s.id).map((m) => m.testId) })) };
}

export async function createTemplates(
  productId: string,
  inputs: CreateTemplateInput[],
) {
  return db.transaction((tx) => createTemplatesIn(tx, productId, inputs));
}

export async function createTemplatesIn(
  tx: Tx,
  productId: string,
  inputs: CreateTemplateInput[],
) {
  const created: string[] = [];
  for (const input of inputs) {
    const [tpl] = await tx
      .insert(template)
      .values({
        productId,
        key: await assignKey(tx, { table: "template", productId }, input.name, input.key),
        name: input.name,
        description: input.description,
        status: input.status,
      })
      .returning();

    for (const [flowIndex, f] of input.flows.entries()) {
      const [flowRow] = await tx
        .insert(flow)
        .values({
          templateId: tpl!.id,
          key: await assignKey(tx, { table: "flow", templateId: tpl!.id }, f.name, f.key),
          name: f.name,
          precondition: f.precondition,
          estimatedMinutes: f.estimatedMinutes,
          position: flowIndex,
          archived: f.archived,
        })
        .returning();

      for (const [stepIndex, s] of f.steps.entries()) {
        const [stepRow] = await tx
          .insert(step)
          .values({
            flowId: flowRow!.id,
            position: stepIndex,
            kind: s.kind,
            text: s.text,
            expectedResult: s.expectedResult,
            postState: s.postState,
            deviceLabel: s.deviceLabel,
          })
          .returning();

        if (s.marks.length) {
          await tx
            .insert(stepMark)
            .values(s.marks.map((testId) => ({ stepId: stepRow!.id, testId })));
        }
      }
    }
    created.push(tpl!.id);
  }
  return created;
}

/**
 * Which of these test ids exist in the product. Marks referencing anything else
 * would fail the foreign key deep inside a transaction; checking first turns
 * that into a 400 that names the id.
 */
export async function existingTestIds(productId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: test.id })
    .from(test)
    .where(and(eq(test.productId, productId), inArray(test.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export type TemplateSummaryRow = {
  id: string;
  product_id: string;
  key: string;
  name: string;
  description: string;
  status: "active" | "archived";
  flow_count: number;
  marks_test_count: number;
};

/** Summary counts for the template list. Scope is reported, never declared. */
export async function listTemplateSummaries(productId: string) {
  return query<TemplateSummaryRow>(raw`
    select
      t.id, t.product_id, t.key, t.name, t.description, t.status,
      count(distinct f.id) filter (where not f.archived)::int as flow_count,
      count(distinct sm.test_id)::int as marks_test_count
    from template t
    left join flow f      on f.template_id = t.id
    left join step s      on s.flow_id = f.id
    left join step_mark sm on sm.step_id = s.id
    where t.product_id = ${productId}
    group by t.id
    order by t.status asc, t.name asc
  `);
}

/* ── Products ────────────────────────────────────────────────────────── */

/** A product as the product routes show it: the graph is part of the suite document, not of every listing. */
const productColumns = { id: product.id, slug: product.slug, name: product.name, description: product.description, createdAt: product.createdAt };

export async function createProduct(input: { name: string; description: string; slug?: string }) {
  const slug = await assignKey(db, { table: "product" }, input.name, input.slug);
  const [row] = await db.insert(product).values({ ...input, slug }).returning(productColumns);
  return row!;
}

export async function deleteProduct(productId: string) {
  const [row] = await db.delete(product).where(eq(product.id, productId)).returning(productColumns);
  return row;
}

export async function listProducts() {
  return db.select(productColumns).from(product).orderBy(asc(product.name));
}

export async function getProduct(productId: string) {
  const [row] = await db.select(productColumns).from(product).where(eq(product.id, productId));
  return row;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A product by id or by slug — `relay` and its UUID name the same thing. */
export async function findProduct(ref: string) {
  const [row] = await db.select(productColumns).from(product).where(UUID.test(ref) ? eq(product.id, ref) : eq(product.slug, ref));
  return row;
}

/**
 * Archiving names the consequence before it happens: a test referenced by
 * six steps across two templates is not something to remove by accident, and the
 * confirmation is only honest if it can say how many.
 */
export async function markCountFor(testId: string) {
  type MarkCount = { steps: number; flows: number; templates: number };
  const rows = await query<MarkCount>(raw`
    select
      count(*)::int                      as steps,
      count(distinct s.flow_id)::int     as flows,
      count(distinct f.template_id)::int as templates
    from step_mark sm
    join step s on s.id = sm.step_id
    join flow f on f.id = s.flow_id
    where sm.test_id = ${testId}
  `);
  return rows[0]!;
}

export async function setArchived(testId: string, archived: boolean) {
  const [row] = await db
    .update(test)
    .set({ archived })
    .where(eq(test.id, testId))
    .returning();
  return row;
}

export { and, eq };

/** A flow's steps in order. The device hand-offs are derived from this, never stored. */
export async function listFlowSteps(flowId: string) {
  return db
    .select()
    .from(step)
    .where(eq(step.flowId, flowId))
    .orderBy(asc(step.position));
}
