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

/* ── Tests ───────────────────────────────────────────────────────────── */

/** A test plus its current version, which is the only form the UI ever wants. */
export const testWithCurrentVersion = {
  id: test.id,
  productId: test.productId,
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
 * script can hold the mapping from its source rows to Flowdeck IDs (D29).
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
  return db.transaction(async (tx) => {
    const created: { id: string; versionId: string }[] = [];
    for (const input of inputs) {
      const [t] = await tx.insert(test).values({ productId }).returning();
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
  });
}

/**
 * Editing creates a new version; the old one is never modified and never deleted
 * (D6). Flows reference the test ID, so nothing needs repointing — the reason the
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

export async function createTemplates(
  productId: string,
  inputs: CreateTemplateInput[],
) {
  return db.transaction(async (tx) => {
    const created: string[] = [];
    for (const input of inputs) {
      const [tpl] = await tx
        .insert(template)
        .values({
          productId,
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
            name: f.name,
            precondition: f.precondition,
            estimatedMinutes: f.estimatedMinutes,
            position: flowIndex,
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
  });
}

export type TemplateSummaryRow = {
  id: string;
  product_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  flow_count: number;
  marks_test_count: number;
};

/** Summary counts for the template list. Scope is reported, never declared (D1). */
export async function listTemplateSummaries(productId: string) {
  return query<TemplateSummaryRow>(raw`
    select
      t.id, t.product_id, t.name, t.description, t.status,
      count(distinct f.id)::int  as flow_count,
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

export async function listProducts() {
  return db.select().from(product).orderBy(asc(product.name));
}

export async function getProduct(productId: string) {
  const [row] = await db.select().from(product).where(eq(product.id, productId));
  return row;
}

/**
 * Archiving names the consequence before it happens (D24): a test referenced by
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
