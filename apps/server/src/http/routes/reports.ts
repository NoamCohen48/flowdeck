/**
 * Reporting: the issue feed (08, D27/D28), closing a day, and one test's
 * history across days. Everything here reads a run's frozen snapshot, so the
 * wording an issue carries is the wording the tester actually read.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { attachmentsForRun, closeRun, getRun, historyOf } from "../../db/runs.ts";
import { getProduct, getTest } from "../../db/queries.ts";
import { sql as raw } from "drizzle-orm";
import { query } from "../../db/client.ts";
import { ErrorSchema, IssueFeedSchema, RunSchema, TestHistoryEntrySchema, Uuid } from "../schemas.ts";
import { iso, runDto } from "../serialize.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const reports = createRouter();

const TYPE = { fail: "failure", minor: "minor", skipped: "invalid_test", pass: "pass" } as const;

reports.openapi(
  createRoute({
    method: "get",
    path: "/runs/{runId}/issues",
    tags: ["Runs", "Integration"],
    summary: "The issue feed: every non-pass result, self-contained",
    description:
      "Typed `failure | minor | invalid_test` (D28). Flowdeck does not filter — the adapter routes failures to the bug tracker and invalid tests to suite maintenance. Pass `includePass=true` for the whole day's data.",
    request: {
      params: z.object({ runId: Uuid }),
      query: z.object({ includePass: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      200: { content: { "application/json": { schema: IssueFeedSchema } }, description: "The feed" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such run" },
    },
  }),
  async (c) => {
    const { runId } = c.req.valid("param");
    const includePass = c.req.valid("query").includePass === "true";
    const run = await getRun(runId);
    if (!run) return c.json({ error: "no such run" }, 404);
    const [tpl] = await query<{ product_id: string; name: string }>(
      raw`select product_id, name from template where id = ${run.templateId}`,
    );
    const product = tpl ? await getProduct(tpl.product_id) : undefined;

    const attachments = new Map<string, string[]>();
    for (const a of await attachmentsForRun(runId)) {
      const list = attachments.get(a.test_result_id) ?? [];
      list.push(`/api/attachments/${a.id}`);
      attachments.set(a.test_result_id, list);
    }
    const flowOfRun = new Map(run.flowRuns.map((fr) => [fr.id, fr.flowId]));
    const tests = new Map(run.snapshot.tests.map((t) => [t.id, t]));
    const versions = new Map(
      (await query<{ id: string; version: number }>(
        raw`select id, version from test_version where test_id in (select id from test where product_id = ${tpl?.product_id ?? null})`,
      )).map((v) => [v.id, v.version]),
    );

    const issues = run.results
      .filter((r) => includePass || r.verdict !== "pass")
      .flatMap((r) => {
        const flow = run.snapshot.flows.find((f) => f.id === flowOfRun.get(r.flowRunId));
        const stepIndex = flow?.steps.findIndex((s) => s.id === r.stepId) ?? -1;
        const step = flow?.steps[stepIndex];
        const test = tests.get(r.testId);
        if (!flow || !step || !test) return [];
        return [{
          type: TYPE[r.verdict],
          test: { id: test.id, versionId: r.testVersionId, version: versions.get(r.testVersionId) ?? 0, title: test.title, expected: test.expectedResult },
          context: { flowId: flow.id, flow: flow.name, stepId: step.id, stepNumber: stepIndex + 1, stepText: step.text, device: step.deviceLabel },
          note: r.note,
          attachments: attachments.get(r.id) ?? [],
          blocking: r.blocking,
          recordedBy: r.recordedBy,
          recordedAt: iso(r.recordedAt),
        }];
      });

    const stepProblems = run.stepProblems.flatMap((p) => {
      const flow = run.snapshot.flows.find((f) => f.id === flowOfRun.get(p.flowRunId));
      const stepIndex = flow?.steps.findIndex((s) => s.id === p.stepId) ?? -1;
      const step = flow?.steps[stepIndex];
      if (!flow || !step) return [];
      return [{
        context: { flowId: flow.id, flow: flow.name, stepId: step.id, stepNumber: stepIndex + 1, stepText: step.text, device: step.deviceLabel },
        note: p.note,
        workaround: p.workaround,
        blocking: p.blocking,
        recordedBy: p.recordedBy,
        recordedAt: iso(p.recordedAt),
      }];
    });

    return c.json(
      {
        run: {
          id: run.id,
          date: iso(run.date),
          closedAt: run.closedAt ? iso(run.closedAt) : null,
          product: product?.name ?? "",
          productId: tpl?.product_id ?? "",
          template: run.snapshot.name,
          templateId: run.templateId,
        },
        issues,
        stepProblems,
      },
      200,
    );
  },
);

reports.openapi(
  createRoute({
    method: "post",
    path: "/runs/{runId}/close",
    tags: ["Runs"],
    summary: "Close a testing day (or reopen it)",
    description:
      "Bookkeeping, not a lock: a closed run leaves the 'open days' list and its report is final. Flows still claimed are left as they are. `reopen=true` undoes it.",
    request: {
      params: z.object({ runId: Uuid }),
      query: z.object({ reopen: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      200: { content: { "application/json": { schema: RunSchema } }, description: "The run" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity on the request" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such run" },
    },
  }),
  async (c) => {
    requireActor(c);
    const { runId } = c.req.valid("param");
    const row = await closeRun(runId, c.req.valid("query").reopen === "true");
    if (!row) return c.json({ error: "no such run" }, 404);
    return c.json(runDto((await getRun(runId))!), 200);
  },
);

reports.openapi(
  createRoute({
    method: "get",
    path: "/tests/{testId}/history",
    tags: ["Tests", "Runs"],
    summary: "One test over time",
    description:
      "Every result ever recorded for the test, newest first, each against the version it ran against — a result from March stays readable against March's wording.",
    request: { params: z.object({ testId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: z.array(TestHistoryEntrySchema) } }, description: "History" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such test" },
    },
  }),
  async (c) => {
    const { testId } = c.req.valid("param");
    if (!(await getTest(testId))) return c.json({ error: "no such test" }, 404);
    const rows = await historyOf(testId);
    return c.json(
      rows.map((r) => ({
        runId: r.run_id,
        runDate: iso(r.run_date),
        template: r.template_name,
        flow: r.flow_name,
        version: r.version,
        title: r.title,
        expected: r.expected_result,
        verdict: r.verdict,
        note: r.note,
        blocking: r.blocking,
        recordedBy: r.recorded_by,
        recordedAt: iso(r.recorded_at),
      })),
      200,
    );
  },
);
