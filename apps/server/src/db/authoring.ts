/**
 * Structural editing of templates, flows and steps — the writes behind the
 * flow editor (`02-authoring.md`, `07-open-items.md` §1).
 *
 * Every step write is scoped to one row and stamps `updated_at`, which is all
 * last-write-wins needs (D37). Positions are dense integers rewritten inside
 * the same transaction as the change, so a reader never sees a gap that is not
 * about to close. Each write returns the transaction id so the editor's
 * optimistic state drops exactly when Electric delivers the real rows.
 */
import { and, asc, eq, gte, notInArray, sql as raw } from "drizzle-orm";
import { db } from "./client.ts";
import { flow, step, stepMark, template } from "./schema.ts";
import { currentTxid } from "./runs.ts";
import type { StepKind } from "@flowdeck/domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StepInput {
  kind: StepKind;
  text: string;
  expectedResult: string | null;
  deviceLabel: string;
  marks: string[];
}

/* ── Templates ───────────────────────────────────────────────────────── */

export async function updateTemplate(
  templateId: string,
  patch: { name?: string; description?: string; status?: "active" | "archived" },
) {
  const [row] = await db
    .update(template)
    .set(patch)
    .where(eq(template.id, templateId))
    .returning();
  return row;
}

/* ── Flows ───────────────────────────────────────────────────────────── */

export async function createFlow(
  templateId: string,
  input: { name: string; precondition: string; estimatedMinutes: number | null },
) {
  return db.transaction(async (tx) => {
    const [nextRow] = (await tx.execute(
      raw`select coalesce(max(position) + 1, 0)::int as next from flow where template_id = ${templateId}`,
    )) as unknown as { next: number }[];
    const [row] = await tx
      .insert(flow)
      .values({ templateId, ...input, position: nextRow!.next })
      .returning();
    return row!;
  });
}

export async function updateFlow(
  flowId: string,
  patch: { name?: string; precondition?: string; estimatedMinutes?: number | null },
) {
  const [row] = await db.update(flow).set(patch).where(eq(flow.id, flowId)).returning();
  return row;
}

/** Deletes the flow and closes the gap in its template's flow order. */
export async function deleteFlow(flowId: string) {
  return db.transaction(async (tx) => {
    const [gone] = await tx.delete(flow).where(eq(flow.id, flowId)).returning();
    if (!gone) return undefined;
    await tx
      .update(flow)
      .set({ position: raw`${flow.position} - 1` })
      .where(and(eq(flow.templateId, gone.templateId), gte(flow.position, gone.position)));
    return gone;
  });
}

export async function reorderFlows(templateId: string, flowIds: string[]) {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: flow.id })
      .from(flow)
      .where(eq(flow.templateId, templateId));
    if (!sameSet(owned.map((f) => f.id), flowIds)) return undefined;
    for (const [i, id] of flowIds.entries()) {
      await tx.update(flow).set({ position: i }).where(eq(flow.id, id));
    }
    return { txid: await currentTxid(tx) };
  });
}

/* ── Steps ───────────────────────────────────────────────────────────── */

/**
 * Insert at `position`, shifting what follows. `position` past the end appends;
 * the editor's between-steps affordance passes the index of the step below.
 */
export async function insertStep(flowId: string, position: number, input: StepInput) {
  return db.transaction(async (tx) => {
    const [countRow] = (await tx.execute(
      raw`select count(*)::int as count from step where flow_id = ${flowId}`,
    )) as unknown as { count: number }[];
    const at = Math.min(Math.max(position, 0), countRow!.count);

    await tx
      .update(step)
      .set({ position: raw`${step.position} + 1` })
      .where(and(eq(step.flowId, flowId), gte(step.position, at)));

    const [row] = await tx
      .insert(step)
      .values({
        flowId,
        position: at,
        kind: input.kind,
        text: input.text,
        expectedResult: input.kind === "assertion" ? input.expectedResult : null,
        deviceLabel: input.deviceLabel,
      })
      .returning();
    await setMarks(tx, row!.id, input.marks);
    return { row: { ...row!, marks: input.marks }, txid: await currentTxid(tx) };
  });
}

/** One step, last write wins (D37). Marks are replaced when given. */
export async function updateStep(stepId: string, patch: Partial<StepInput>) {
  return db.transaction(async (tx) => {
    const { marks, ...fields } = patch;
    const [row] = await tx
      .update(step)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(step.id, stepId))
      .returning();
    if (!row) return undefined;
    if (row.kind === "action" && row.expectedResult !== null) {
      await tx.update(step).set({ expectedResult: null }).where(eq(step.id, stepId));
      row.expectedResult = null;
    }
    if (marks) await setMarks(tx, stepId, marks);
    const current = await tx
      .select({ testId: stepMark.testId })
      .from(stepMark)
      .where(eq(stepMark.stepId, stepId));
    return {
      row: { ...row, marks: current.map((m) => m.testId) },
      txid: await currentTxid(tx),
    };
  });
}

export async function deleteStep(stepId: string) {
  return db.transaction(async (tx) => {
    const [gone] = await tx.delete(step).where(eq(step.id, stepId)).returning();
    if (!gone) return undefined;
    await tx
      .update(step)
      .set({ position: raw`${step.position} - 1` })
      .where(and(eq(step.flowId, gone.flowId), gte(step.position, gone.position)));
    return { row: gone, txid: await currentTxid(tx) };
  });
}

/**
 * The whole order at once — a drag lands as one transaction, so a second author
 * never sees two steps sharing a slot. Rejects anything but a permutation of the
 * flow's own steps, which is what a stale drag against a flow someone else just
 * edited looks like.
 */
export async function reorderSteps(flowId: string, stepIds: string[]) {
  return db.transaction(async (tx) => {
    const owned = await tx.select({ id: step.id }).from(step).where(eq(step.flowId, flowId));
    if (!sameSet(owned.map((s) => s.id), stepIds)) return undefined;
    for (const [i, id] of stepIds.entries()) {
      await tx
        .update(step)
        .set({ position: i, updatedAt: new Date() })
        .where(and(eq(step.id, id), raw`${step.position} <> ${i}`));
    }
    return { txid: await currentTxid(tx) };
  });
}

export async function addMark(stepId: string, testId: string) {
  return db.transaction(async (tx) => {
    await tx.insert(stepMark).values({ stepId, testId }).onConflictDoNothing();
    return { txid: await currentTxid(tx) };
  });
}

export async function removeMark(stepId: string, testId: string) {
  return db.transaction(async (tx) => {
    await tx
      .delete(stepMark)
      .where(and(eq(stepMark.stepId, stepId), eq(stepMark.testId, testId)));
    return { txid: await currentTxid(tx) };
  });
}

/** Every step that marks a test, with where it lives — the answer to "if I change this, what am I affecting?" */
export async function usagesOf(testId: string) {
  const rows = await db
    .select({
      stepId: step.id,
      stepText: step.text,
      stepIndex: step.position,
      deviceLabel: step.deviceLabel,
      flowId: flow.id,
      flowName: flow.name,
      templateId: template.id,
      templateName: template.name,
      templateStatus: template.status,
    })
    .from(stepMark)
    .innerJoin(step, eq(step.id, stepMark.stepId))
    .innerJoin(flow, eq(flow.id, step.flowId))
    .innerJoin(template, eq(template.id, flow.templateId))
    .where(eq(stepMark.testId, testId))
    .orderBy(asc(template.name), asc(flow.position), asc(step.position));
  return rows;
}

async function setMarks(tx: Tx, stepId: string, marks: string[]) {
  const wanted = [...new Set(marks)];
  await tx
    .delete(stepMark)
    .where(
      wanted.length
        ? and(eq(stepMark.stepId, stepId), notInArray(stepMark.testId, wanted))
        : eq(stepMark.stepId, stepId),
    );
  if (wanted.length) {
    await tx
      .insert(stepMark)
      .values(wanted.map((testId) => ({ stepId, testId })))
      .onConflictDoNothing();
  }
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length || new Set(b).size !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
