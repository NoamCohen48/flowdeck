/**
 * The testing day (`.docs/03-execution.md`). Starting a run, claiming flows,
 * recording verdicts, finishing or abandoning. The most important surface in
 * the product is the one that reads from these.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { blockingStepIndex, computeBlocked, verdictRequiresNote } from "@flowdeck/domain";
import { db } from "../../db/client.ts";
import { actor as actorTable, presence } from "../../db/schema.ts";
import {
  deleteResult,
  deleteStepProblem,
  claimFlow,
  getFlowRun,
  getRun,
  listRuns,
  openRunFor,
  recordResult,
  recordStepProblem,
  setFlowRunState,
  startRun,
  type TemplateSnapshot,
} from "../../db/runs.ts";
import { getProduct } from "../../db/queries.ts";
import {
  ClaimResponseSchema,
  ErrorSchema,
  FlowRunSchema,
  MeSchema,
  PassAllSchema,
  PresenceSchema,
  RecordResultSchema,
  RecordStepProblemSchema,
  RunSchema,
  StepProblemSchema,
  RunSummarySchema,
  TestResultSchema,
  Uuid,
  TxidSchema,
} from "../schemas.ts";
import { flowRunDto, iso, resultDto, runDto, stepProblemDto } from "../serialize.ts";
import { requireActor, setActor } from "../actor.ts";
import { createRouter } from "../router.ts";
import { sql as raw } from "drizzle-orm";

export const runs = createRouter();

/* ── Identity (D38) ──────────────────────────────────────────────────── */

runs.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["Identity"],
    summary: "Who this browser says it is",
    responses: {
      200: { content: { "application/json": { schema: MeSchema } }, description: "Name or null" },
    },
  }),
  (c) => c.json({ name: c.get("actor") }, 200),
);

runs.openapi(
  createRoute({
    method: "put",
    path: "/me",
    tags: ["Identity"],
    summary: "Pick a name",
    description:
      "A name picker, not authentication. Seven people in one room, no roles, every change attributed (D24, D38).",
    request: {
      body: {
        content: { "application/json": { schema: z.object({ name: z.string().trim().min(1).max(60) }) } },
      },
    },
    responses: {
      200: { content: { "application/json": { schema: MeSchema } }, description: "Set" },
    },
  }),
  async (c) => {
    const { name } = c.req.valid("json");
    await setActor(c, name);
    await db
      .insert(actorTable)
      .values({ name })
      .onConflictDoUpdate({ target: actorTable.name, set: { lastSeenAt: new Date() } });
    return c.json({ name }, 200);
  },
);

runs.openapi(
  createRoute({
    method: "get",
    path: "/actors",
    tags: ["Identity"],
    summary: "Names seen on this instance, for the picker",
    responses: {
      200: {
        content: { "application/json": { schema: z.array(z.string()) } },
        description: "Most recently seen first",
      },
    },
  }),
  async (c) => {
    const rows = await db
      .select({ name: actorTable.name })
      .from(actorTable)
      .orderBy(raw`${actorTable.lastSeenAt} desc`);
    return c.json(rows.map((r) => r.name), 200);
  },
);

/* ── Presence (D37) ──────────────────────────────────────────────────── */

runs.openapi(
  createRoute({
    method: "put",
    path: "/presence",
    tags: ["Identity"],
    summary: "Heartbeat: I am looking at this run / flow / template",
    request: { body: { content: { "application/json": { schema: PresenceSchema } } } },
    responses: {
      204: { description: "Recorded" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { scope } = c.req.valid("json");
    await db
      .insert(presence)
      .values({ actor: who, scope })
      .onConflictDoUpdate({
        target: [presence.actor, presence.scope],
        set: { lastSeenAt: new Date() },
      });
    // Sweep anyone silent for over a minute; cheap, and keeps the shape honest.
    await db.delete(presence).where(raw`${presence.lastSeenAt} < now() - interval '60 seconds'`);
    return c.body(null, 204);
  },
);

runs.openapi(
  createRoute({
    method: "delete",
    path: "/presence",
    tags: ["Identity"],
    summary: "I have left this scope",
    request: { body: { content: { "application/json": { schema: PresenceSchema } } } },
    responses: { 204: { description: "Removed" } },
  }),
  async (c) => {
    const who = c.get("actor");
    if (who) {
      const { scope } = c.req.valid("json");
      await db
        .delete(presence)
        .where(raw`${presence.actor} = ${who} and ${presence.scope} = ${scope}`);
    }
    return c.body(null, 204);
  },
);

/* ── Runs ────────────────────────────────────────────────────────────── */

runs.openapi(
  createRoute({
    method: "get",
    path: "/products/{productId}/runs",
    tags: ["Runs"],
    summary: "Testing days for a product, newest first",
    request: { params: z.object({ productId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: z.array(RunSummarySchema) } }, description: "Runs" },
    },
  }),
  async (c) => {
    const rows = await listRuns(c.req.valid("param").productId);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        templateId: r.template_id,
        templateName: r.template_name,
        date: iso(r.date),
        startedBy: r.started_by,
        closedAt: r.closed_at ? iso(r.closed_at) : null,
      })),
      200,
    );
  },
);

runs.openapi(
  createRoute({
    method: "post",
    path: "/templates/{templateId}/runs",
    tags: ["Runs"],
    summary: "Start a testing day",
    description:
      "Takes a frozen snapshot of the template (D21). Edits made during the day apply to the next run, never this one. Warns, via 409, if a run is already open for this template unless `force=true` (D24).",
    request: {
      params: z.object({ templateId: Uuid }),
      query: z.object({ force: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      201: { content: { "application/json": { schema: RunSchema } }, description: "The new run" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such template" },
      409: {
        content: { "application/json": { schema: ErrorSchema.extend({ openRunId: Uuid }) } },
        description: "A run is already open for this template",
      },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { templateId } = c.req.valid("param");
    const { force } = c.req.valid("query");

    const open = await openRunFor(templateId);
    if (open && force !== "true") {
      return c.json(
        {
          error: "A testing day is already open for this template. Start another anyway?",
          openRunId: open.id,
        },
        409,
      );
    }

    const created = await startRun(templateId, who);
    if (!created) return c.json({ error: "no such template" }, 404);
    return c.json(runDto((await getRun(created.id))!), 201);
  },
);

runs.openapi(
  createRoute({
    method: "get",
    path: "/runs/{runId}",
    tags: ["Runs"],
    summary: "Full run state: snapshot, flow runs, every result",
    request: { params: z.object({ runId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: RunSchema } }, description: "The run" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such run" },
    },
  }),
  async (c) => {
    const r = await getRun(c.req.valid("param").runId);
    return r ? c.json(runDto(r), 200) : c.json({ error: "no such run" }, 404);
  },
);

/* ── Claiming (D9, D26) ──────────────────────────────────────────────── */

runs.openapi(
  createRoute({
    method: "post",
    path: "/runs/{runId}/flows/{flowId}/claim",
    tags: ["Runs"],
    summary: "Claim a flow",
    description:
      "Advisory, not exclusive (D26). If someone already holds it, you get your own FlowRun alongside theirs and the response lists them, so the UI can ask 'Dana is on step 12 of 34 — run it anyway?' before this is called with confirm=true.",
    request: {
      params: z.object({ runId: Uuid, flowId: Uuid }),
      query: z.object({ confirm: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      200: { content: { "application/json": { schema: ClaimResponseSchema } }, description: "Claimed" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such run or flow" },
      409: {
        content: { "application/json": { schema: ClaimResponseSchema.omit({ flowRun: true, txid: true }) } },
        description: "Already claimed by someone else; confirm to run alongside",
      },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { runId, flowId } = c.req.valid("param");
    const { confirm } = c.req.valid("query");

    const r = await getRun(runId);
    if (!r || !r.snapshot.flows.some((f) => f.id === flowId)) {
      return c.json({ error: "no such run or flow" }, 404);
    }

    const claimed = await claimFlow(runId, flowId, who, confirm === "true");
    if ("conflict" in claimed) {
      return c.json({ alsoRunning: claimed.conflict.map(flowRunDto) }, 409);
    }
    return c.json(
      { flowRun: flowRunDto(claimed.row), txid: claimed.txid, alsoRunning: claimed.others.map(flowRunDto) },
      200,
    );
  },
);

for (const [action, state, summary] of [
  ["finish", "finished", "Finish a flow"],
  ["abandon", "abandoned", "Abandon a flow — the next person starts from step 1 (D10)"],
] as const) {
  runs.openapi(
    createRoute({
      method: "post",
      path: `/flow-runs/{flowRunId}/${action}`,
      tags: ["Runs"],
      summary,
      request: { params: z.object({ flowRunId: Uuid }) },
      responses: {
        200: { content: { "application/json": { schema: FlowRunSchema } }, description: "Updated" },
        401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such flow run" },
      },
    }),
    async (c) => {
      requireActor(c);
      const fr = await setFlowRunState(c.req.valid("param").flowRunId, state);
      return fr
        ? c.json({ ...flowRunDto(fr.row), txid: fr.txid }, 200)
        : c.json({ error: "no such flow run" }, 404);
    },
  );
}

/* ── Results (D11, D12, D13, D36) ────────────────────────────────────── */

function findStep(snapshot: TemplateSnapshot, flowId: string, stepId: string) {
  const flow = snapshot.flows.find((f) => f.id === flowId);
  const step = flow?.steps.find((s) => s.id === stepId);
  return flow && step ? { flow, step } : undefined;
}

/**
 * What one tester's flow run has already put out of reach: everything after a
 * blocking failure (D11) or a flagged step they could not get past (D40).
 */
function blockedIn(r: NonNullable<Awaited<ReturnType<typeof getRun>>>, flowRunId: string, flow: TemplateSnapshot["flows"][number]) {
  const blockers = [
    ...r.results.filter((x) => x.flowRunId === flowRunId && x.verdict === "fail").map((x) => ({ stepId: x.stepId, blocking: x.blocking })),
    ...r.stepProblems.filter((x) => x.flowRunId === flowRunId).map((x) => ({ stepId: x.stepId, blocking: x.blocking })),
  ];
  return computeBlocked(flow.steps, blockingStepIndex(flow.steps, blockers));
}

runs.openapi(
  createRoute({
    method: "post",
    path: "/flow-runs/{flowRunId}/results",
    tags: ["Runs"],
    summary: "Record a verdict for one test on one step",
    description:
      "Per test, not per step (D12). Fail and skipped require a note (D13). Idempotent on the client key (D36). A blocking failure marks every later step in the flow as blocked; their tests report as not verified, never as failures (D11).",
    request: {
      params: z.object({ flowRunId: Uuid }),
      body: { content: { "application/json": { schema: RecordResultSchema } } },
    },
    responses: {
      201: { content: { "application/json": { schema: TestResultSchema } }, description: "Recorded" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such flow run, step or test" },
      409: { content: { "application/json": { schema: ErrorSchema } }, description: "This step is blocked" },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { flowRunId } = c.req.valid("param");
    const body = c.req.valid("json");

    const fr = await getFlowRun(flowRunId);
    if (!fr) return c.json({ error: "no such flow run" }, 404);
    const r = (await getRun(fr.runId))!;
    const found = findStep(r.snapshot, fr.flowId, body.stepId);
    if (!found) return c.json({ error: "no such step in this flow" }, 404);
    if (!found.step.marks.includes(body.testId)) {
      return c.json({ error: "this step does not mark that test" }, 400);
    }
    const snapshotTest = r.snapshot.tests.find((t) => t.id === body.testId);
    if (!snapshotTest) return c.json({ error: "test not in this run's snapshot" }, 404);

    // Refuse to record anything on a step a blocking failure has already put out
    // of reach. Recording a pass for a wedged step would be a lie (D11).
    if (blockedIn(r, flowRunId, found.flow).blockedStepIds.has(body.stepId)) {
      return c.json({ error: "this step is blocked by an earlier failure" }, 409);
    }

    if (verdictRequiresNote(body.verdict) && !body.note) {
      return c.json({ error: "a note is required for this verdict" }, 400);
    }

    const { row, txid } = await recordResult({
      flowRunId,
      stepId: body.stepId,
      testId: body.testId,
      testVersionId: snapshotTest.versionId,
      verdict: body.verdict,
      note: body.note,
      blocking: body.verdict === "fail" ? body.blocking : false,
      recordedBy: who,
      idempotencyKey: body.idempotencyKey,
    });
    return c.json({ ...resultDto(row), txid }, 201);
  },
);

runs.openapi(
  createRoute({
    method: "delete",
    path: "/results/{resultId}",
    tags: ["Runs"],
    summary: "Retract a verdict",
    description:
      "Removes one result and its attachments; the test reads as not verified on that step again. To change a verdict, record it again instead — the newer one replaces the older. This is for a result that should never have been recorded.",
    request: { params: z.object({ resultId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Retracted" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such result" },
    },
  }),
  async (c) => {
    requireActor(c);
    const gone = await deleteResult(c.req.valid("param").resultId);
    return gone ? c.json({ txid: gone.txid }, 200) : c.json({ error: "no such result" }, 404);
  },
);

runs.openapi(
  createRoute({
    method: "delete",
    path: "/flow-runs/{flowRunId}/step-problems/{stepId}",
    tags: ["Runs"],
    summary: "Withdraw a step report",
    description: "The step was fine after all, or its blocking report should stop blocking the rest of the flow.",
    request: { params: z.object({ flowRunId: Uuid, stepId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Withdrawn" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such report" },
    },
  }),
  async (c) => {
    requireActor(c);
    const { flowRunId, stepId } = c.req.valid("param");
    const gone = await deleteStepProblem(flowRunId, stepId);
    return gone ? c.json({ txid: gone.txid }, 200) : c.json({ error: "no such step report" }, 404);
  },
);

runs.openapi(
  createRoute({
    method: "post",
    path: "/flow-runs/{flowRunId}/pass-all",
    tags: ["Runs"],
    summary: "Pass every test a step marks, in one click",
    description: "The common case stays as fast as the old per-step checkbox (D12).",
    request: {
      params: z.object({ flowRunId: Uuid }),
      body: { content: { "application/json": { schema: PassAllSchema } } },
    },
    responses: {
      201: { content: { "application/json": { schema: z.array(TestResultSchema) } }, description: "Recorded" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such flow run or step" },
      409: { content: { "application/json": { schema: ErrorSchema } }, description: "This step is blocked" },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { flowRunId } = c.req.valid("param");
    const { stepId, idempotencyKeyPrefix } = c.req.valid("json");

    const fr = await getFlowRun(flowRunId);
    if (!fr) return c.json({ error: "no such flow run" }, 404);
    const r = (await getRun(fr.runId))!;
    const found = findStep(r.snapshot, fr.flowId, stepId);
    if (!found) return c.json({ error: "no such step in this flow" }, 404);

    if (blockedIn(r, flowRunId, found.flow).blockedStepIds.has(stepId)) {
      return c.json({ error: "this step is blocked by an earlier failure" }, 409);
    }

    const rows = [];
    for (const testId of found.step.marks) {
      const snapshotTest = r.snapshot.tests.find((t) => t.id === testId);
      if (!snapshotTest) continue;
      const recorded = await recordResult({
          flowRunId,
          stepId,
          testId,
          testVersionId: snapshotTest.versionId,
          verdict: "pass",
          note: null,
          blocking: false,
          recordedBy: who,
          idempotencyKey: `${idempotencyKeyPrefix}:${testId}`,
        });
      rows.push({ ...resultDto(recorded.row), txid: recorded.txid });
    }
    return c.json(rows, 201);
  },
);


/* ── Step problems (D40) ─────────────────────────────────────────────── */

runs.openapi(
  createRoute({
    method: "post",
    path: "/flow-runs/{flowRunId}/step-problems",
    tags: ["Runs"],
    summary: "Flag a step as wrong",
    description:
      "\"The step, not the product\": the button moved, the wording is stale, the screen is gone (D40). Not a verdict — the tests the step marks can still be recorded. Either the tester got past it and `workaround` says how, or `blocking=true` closes the rest of the flow exactly as a blocking failure does (D11). One report per step per flow run; flagging again replaces it.",
    request: {
      params: z.object({ flowRunId: Uuid }),
      body: { content: { "application/json": { schema: RecordStepProblemSchema } } },
    },
    responses: {
      201: { content: { "application/json": { schema: StepProblemSchema } }, description: "Recorded" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such flow run or step" },
      409: { content: { "application/json": { schema: ErrorSchema } }, description: "This step is blocked" },
    },
  }),
  async (c) => {
    const who = requireActor(c);
    const { flowRunId } = c.req.valid("param");
    const body = c.req.valid("json");

    const fr = await getFlowRun(flowRunId);
    if (!fr) return c.json({ error: "no such flow run" }, 404);
    const r = (await getRun(fr.runId))!;
    const found = findStep(r.snapshot, fr.flowId, body.stepId);
    if (!found) return c.json({ error: "no such step in this flow" }, 404);
    // A step nobody reached cannot be reported as wrong — nobody looked at it.
    if (blockedIn(r, flowRunId, found.flow).blockedStepIds.has(body.stepId)) {
      return c.json({ error: "this step is blocked by an earlier failure" }, 409);
    }

    const { row, txid } = await recordStepProblem({
      flowRunId,
      stepId: body.stepId,
      note: body.note,
      workaround: body.blocking ? null : body.workaround,
      blocking: body.blocking,
      recordedBy: who,
    });
    return c.json({ ...stepProblemDto(row), txid }, 201);
  },
);
