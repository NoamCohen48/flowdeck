/**
 * Runs, flow runs and results — the testing-day data path.
 *
 * The template is the class; the run is the object (D8). Everything here reads
 * from the run's frozen snapshot, never the live template (D21).
 */
import { and, asc, desc, eq, sql as raw } from "drizzle-orm";
import { db, query } from "./client.ts";
import { attachment, flowRun, run, testResult } from "./schema.ts";
import type { FlowRunState, StepKind, Verdict } from "@flowdeck/domain";

/* ── The snapshot ────────────────────────────────────────────────────── */

export interface SnapshotStep {
  id: string;
  position: number;
  kind: StepKind;
  text: string;
  expectedResult: string | null;
  deviceLabel: string;
  marks: string[];
}

export interface SnapshotFlow {
  id: string;
  name: string;
  precondition: string;
  estimatedMinutes: number | null;
  position: number;
  steps: SnapshotStep[];
}

export interface SnapshotTest {
  id: string;
  versionId: string;
  title: string;
  expectedResult: string;
}

export interface TemplateSnapshot {
  id: string;
  name: string;
  description: string;
  takenAt: string;
  flows: SnapshotFlow[];
  /** Every test the flows mark, at the version current when the run started.
      Results pin `versionId`, so the day reads against the wording testers saw. */
  tests: SnapshotTest[];
}

/**
 * The frozen copy a run executes against (D21). Taken at start, never re-read,
 * so an edit during the day cannot reshuffle the checklist of a tester on step 14.
 */
export async function snapshotTemplate(
  templateId: string,
): Promise<TemplateSnapshot | undefined> {
  const [tpl] = await query<{
    id: string;
    name: string;
    description: string;
    flows: Omit<SnapshotFlow, never>[];
  }>(raw`
    select
      tpl.id, tpl.name, tpl.description,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', f.id, 'name', f.name, 'precondition', f.precondition,
          'estimatedMinutes', f.estimated_minutes, 'position', f.position,
          'steps', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', s.id, 'position', s.position, 'kind', s.kind, 'text', s.text,
              'expectedResult', s.expected_result, 'deviceLabel', s.device_label,
              'marks', (select coalesce(jsonb_agg(sm.test_id), '[]'::jsonb)
                        from step_mark sm where sm.step_id = s.id)
            ) order by s.position), '[]'::jsonb)
            from step s where s.flow_id = f.id
          )
        ) order by f.position
      ) filter (where f.id is not null), '[]'::jsonb) as flows
    from template tpl
    left join flow f on f.template_id = tpl.id
    where tpl.id = ${templateId}
    group by tpl.id
  `);
  if (!tpl) return undefined;

  const tests = await query<SnapshotTest>(raw`
    select distinct t.id, tv.id as "versionId", tv.title, tv.expected_result as "expectedResult"
    from step_mark sm
    join step s on s.id = sm.step_id
    join flow f on f.id = s.flow_id
    join test t on t.id = sm.test_id
    join test_version tv on tv.id = t.current_version_id
    where f.template_id = ${templateId}
  `);

  return {
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    takenAt: new Date().toISOString(),
    flows: tpl.flows,
    tests,
  };
}

/**
 * The transaction id of the current transaction, as a number the browser can
 * compare against Electric's stream. A write handler returns it so the client's
 * optimistic state is dropped exactly when the real row arrives, not on a timer.
 */
async function currentTxid(tx: { execute: typeof db.execute }): Promise<number> {
  const rows = (await tx.execute(
    raw`select pg_current_xact_id()::xid::text::bigint as txid`,
  )) as unknown as { txid: string | number }[];
  return Number(rows[0]!.txid);
}

/* ── Runs ────────────────────────────────────────────────────────────── */

export async function startRun(templateId: string, startedBy: string) {
  const snapshot = await snapshotTemplate(templateId);
  if (!snapshot) return undefined;

  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(run)
      .values({ templateId, templateSnapshot: snapshot, startedBy })
      .returning();

    // One open FlowRun per flow, so the board has a row to show before anyone
    // claims anything. Claims by further testers add rows (D26).
    if (snapshot.flows.length) {
      await tx.insert(flowRun).values(
        snapshot.flows.map((f) => ({ runId: r!.id, flowId: f.id, state: "open" as const })),
      );
    }
    return r!;
  });
}

export async function getRun(runId: string) {
  const [r] = await db.select().from(run).where(eq(run.id, runId));
  if (!r) return undefined;
  const flowRuns = await db
    .select()
    .from(flowRun)
    .where(eq(flowRun.runId, runId))
    .orderBy(asc(flowRun.startedAt));
  const results = await db
    .select()
    .from(testResult)
    .innerJoin(flowRun, eq(flowRun.id, testResult.flowRunId))
    .where(eq(flowRun.runId, runId))
    .orderBy(asc(testResult.recordedAt));
  return {
    ...r,
    snapshot: r.templateSnapshot as TemplateSnapshot,
    flowRuns,
    results: results.map((row) => row.test_result),
  };
}

export async function listRuns(productId: string) {
  return query<{
    id: string;
    template_id: string;
    template_name: string;
    date: string;
    started_by: string;
    closed_at: string | null;
  }>(raw`
    select r.id, r.template_id, t.name as template_name, r.date, r.started_by, r.closed_at
    from run r
    join template t on t.id = r.template_id
    where t.product_id = ${productId}
    order by r.date desc
  `);
}

/** A run already open for this template — the "start a run" confirmation warns about it (D24). */
export async function openRunFor(templateId: string) {
  const [r] = await db
    .select()
    .from(run)
    .where(and(eq(run.templateId, templateId), raw`${run.closedAt} is null`))
    .orderBy(desc(run.date))
    .limit(1);
  return r;
}

/* ── Flow runs ───────────────────────────────────────────────────────── */

export async function getFlowRun(flowRunId: string) {
  const [fr] = await db.select().from(flowRun).where(eq(flowRun.id, flowRunId));
  return fr;
}

/**
 * Claiming is advisory (D26). If the flow's open placeholder row is unclaimed,
 * this tester takes it; otherwise a new FlowRun is created alongside whoever is
 * already on it. Nobody is ever kicked off, and both result sets are kept.
 */
export async function claimFlow(runId: string, flowId: string, actor: string) {
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select()
      .from(flowRun)
      .where(
        and(eq(flowRun.runId, runId), eq(flowRun.flowId, flowId), eq(flowRun.state, "open")),
      )
      .limit(1);

    if (open) {
      const [claimed] = await tx
        .update(flowRun)
        .set({ claimedBy: actor, state: "claimed", startedAt: new Date() })
        .where(eq(flowRun.id, open.id))
        .returning();
      return { row: claimed!, txid: await currentTxid(tx) };
    }

    const [created] = await tx
      .insert(flowRun)
      .values({ runId, flowId, claimedBy: actor, state: "claimed" })
      .returning();
    return { row: created!, txid: await currentTxid(tx) };
  });
}

export async function setFlowRunState(flowRunId: string, state: FlowRunState) {
  return db.transaction(async (tx) => {
    const [fr] = await tx
      .update(flowRun)
      .set({
        state,
        finishedAt: state === "finished" || state === "abandoned" ? new Date() : null,
      })
      .where(eq(flowRun.id, flowRunId))
      .returning();
    return fr ? { row: fr, txid: await currentTxid(tx) } : undefined;
  });
}

/* ── Results ─────────────────────────────────────────────────────────── */

export interface RecordResultInput {
  flowRunId: string;
  stepId: string;
  testId: string;
  testVersionId: string;
  verdict: Verdict;
  note: string | null;
  blocking: boolean;
  recordedBy: string;
  idempotencyKey: string;
}

/**
 * Upsert on the idempotency key (D36): a tired tester tapping twice records
 * once. A *different* verdict for the same test on the same step in the same
 * flow run replaces the earlier one — the tester changed their mind, and the
 * latest opinion is the one that stands.
 */
export async function recordResult(input: RecordResultInput) {
  return db.transaction(async (tx) => {
    // Changing one's mind: remove the earlier verdict for this test on this step.
    await tx
      .delete(testResult)
      .where(
        and(
          eq(testResult.flowRunId, input.flowRunId),
          eq(testResult.stepId, input.stepId),
          eq(testResult.testId, input.testId),
          raw`${testResult.idempotencyKey} <> ${input.idempotencyKey}`,
        ),
      );

    const [row] = await tx
      .insert(testResult)
      .values(input)
      .onConflictDoUpdate({
        target: testResult.idempotencyKey,
        set: { verdict: input.verdict, note: input.note, blocking: input.blocking },
      })
      .returning();
    return { row: row!, txid: await currentTxid(tx) };
  });
}

export async function getResult(resultId: string) {
  const [r] = await db.select().from(testResult).where(eq(testResult.id, resultId));
  return r;
}

export async function addAttachment(input: {
  testResultId: string;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
}) {
  const [row] = await db.insert(attachment).values(input).returning();
  return row!;
}

export async function listAttachments(testResultId: string) {
  return db.select().from(attachment).where(eq(attachment.testResultId, testResultId));
}
