/**
 * Live collections (D32, D33), one per shape the server allows.
 *
 * TanStack DB holds the rows Electric syncs; components read them with live
 * queries and join them client-side. Writes still go through REST — each handler
 * returns the Postgres txid the API reported, and the collection drops its
 * optimistic state exactly when the stream delivers that transaction.
 *
 * Rows are in the database's own column names, because that is what Electric
 * streams. The API's camelCase DTOs are a different shape on purpose; the two
 * never mix in one component.
 */
import { createCollection } from "@tanstack/react-db";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import { api, unwrap } from "./api.ts";

export type FlowRunRow = {
  id: string;
  run_id: string;
  flow_id: string;
  claimed_by: string | null;
  state: "open" | "claimed" | "finished" | "abandoned" | "released";
  started_at: string;
  finished_at: string | null;
};

export type TestResultRow = {
  id: string;
  flow_run_id: string;
  step_id: string;
  test_id: string;
  test_version_id: string;
  verdict: "pass" | "fail" | "minor" | "skipped";
  note: string | null;
  blocking: boolean;
  recorded_by: string;
  recorded_at: string;
  idempotency_key: string;
};

/** "This step is wrong" (D40): one per step per flow run, not a verdict. */
export type StepProblemRow = {
  id: string;
  flow_run_id: string;
  step_id: string;
  note: string;
  workaround: string | null;
  blocking: boolean;
  recorded_by: string;
  recorded_at: string;
};

export type PresenceRow = {
  actor: string;
  scope: string;
  last_seen_at: string;
};

export type StepMarkRow = { step_id: string; test_id: string };
export type TestRow = {
  id: string;
  product_id: string;
  current_version_id: string | null;
  archived: boolean;
  created_at: string;
};

/** ShapeStream wants an absolute URL; the proxy lives on the page's own origin. */
const shapeUrl = (name: string) => new URL(`/api/shapes/${name}`, window.location.origin).toString();

const cache = new Map<string, unknown>();

/** Collections are keyed so a route re-render reuses the open stream. */
function memo<T>(key: string, make: () => T): T {
  let value = cache.get(key) as T | undefined;
  if (!value) {
    value = make();
    cache.set(key, value);
  }
  return value;
}

export function flowRunsOf(runId: string) {
  return memo(`flow_runs:${runId}`, () =>
    createCollection(
      electricCollectionOptions<FlowRunRow>({
        id: `flow_runs:${runId}`,
        shapeOptions: { url: shapeUrl("run.flow_runs"), params: { runId } },
        getKey: (r) => r.id,
      }),
    ),
  );
}

export function resultsOf(runId: string) {
  return memo(`results:${runId}`, () =>
    createCollection(
      electricCollectionOptions<TestResultRow>({
        id: `results:${runId}`,
        shapeOptions: { url: shapeUrl("run.results"), params: { runId } },
        getKey: (r) => r.id,
        /**
         * A verdict is an optimistic insert: the row appears on the tester's own
         * screen instantly, the API records it, and the placeholder is swapped for
         * the real row when Electric delivers the transaction the API named.
         * A changed verdict is a new insert too — the server replaces the earlier
         * row for that step and test, and the stream carries the delete.
         */
        onInsert: async ({ transaction }) => {
          const txids = await Promise.all(
            transaction.mutations.map(async (m) => {
              const r = m.modified;
              const recorded = await unwrap(
                api.POST("/flow-runs/{flowRunId}/results", {
                  params: { path: { flowRunId: r.flow_run_id } },
                  body: {
                    stepId: r.step_id,
                    testId: r.test_id,
                    verdict: r.verdict,
                    note: r.note,
                    blocking: r.blocking,
                    idempotencyKey: r.idempotency_key,
                  },
                }),
              );
              return recorded.txid ?? 0;
            }),
          );
          return { txid: txids.filter((t) => t > 0) };
        },
      }),
    ),
  );
}

export function stepProblemsOf(runId: string) {
  return memo(`step_problems:${runId}`, () =>
    createCollection(
      electricCollectionOptions<StepProblemRow>({
        id: `step_problems:${runId}`,
        shapeOptions: { url: shapeUrl("run.step_problems"), params: { runId } },
        getKey: (r) => r.id,
      }),
    ),
  );
}

export function presenceOf(scope: string) {
  return memo(`presence:${scope}`, () =>
    createCollection(
      electricCollectionOptions<PresenceRow>({
        id: `presence:${scope}`,
        shapeOptions: { url: shapeUrl("presence"), params: { scope } },
        getKey: (r) => `${r.actor}|${r.scope}`,
      }),
    ),
  );
}

export function marksOf(productId: string) {
  return memo(`marks:${productId}`, () =>
    createCollection(
      electricCollectionOptions<StepMarkRow>({
        id: `marks:${productId}`,
        shapeOptions: { url: shapeUrl("product.marks"), params: { productId } },
        getKey: (r) => `${r.step_id}|${r.test_id}`,
      }),
    ),
  );
}

export function testsOf(productId: string) {
  return memo(`tests:${productId}`, () =>
    createCollection(
      electricCollectionOptions<TestRow>({
        id: `tests:${productId}`,
        shapeOptions: { url: shapeUrl("product.tests"), params: { productId } },
        getKey: (r) => r.id,
      }),
    ),
  );
}

/* ── The flow editor (D37) ──────────────────────────────────────────────
   Steps and marks of one flow. Writes are optimistic: the author sees the
   change at once, the API confirms it with a txid, and the stream carries the
   same rows to any other author with the flow open. */

export type StepRow = {
  id: string;
  flow_id: string;
  position: number;
  kind: "action" | "assertion";
  text: string;
  expected_result: string | null;
  post_state: string | null;
  device_label: string;
  updated_at: string;
};

/** A drag passes the whole new order here, so one request carries one transaction. */
export const ORDER = "order";

export function stepsOf(flowId: string) {
  return memo(`steps:${flowId}`, () =>
    createCollection(
      electricCollectionOptions<StepRow>({
        id: `steps:${flowId}`,
        shapeOptions: { url: shapeUrl("flow.steps"), params: { flowId } },
        getKey: (r) => r.id,
        onInsert: async ({ transaction }) => {
          const txids = await Promise.all(
            transaction.mutations.map(async (m) => {
              const r = m.modified;
              const created = await unwrap(
                api.POST("/flows/{flowId}/steps", {
                  params: { path: { flowId: r.flow_id } },
                  body: {
                    // The optimistic row sits half a slot above the step it displaces.
                    position: Math.ceil(r.position),
                    kind: r.kind,
                    text: r.text,
                    expectedResult: r.expected_result,
                    postState: r.post_state,
                    deviceLabel: r.device_label,
                    marks: (m.metadata as { marks?: string[] } | undefined)?.marks ?? [],
                  },
                }),
              );
              return created.txid;
            }),
          );
          return { txid: txids };
        },
        onUpdate: async ({ transaction }) => {
          const first = transaction.mutations[0];
          const order = (first?.metadata as { [ORDER]?: string[] } | undefined)?.[ORDER];
          if (order && first) {
            const done = await unwrap(
              api.PUT("/flows/{flowId}/steps/order", {
                params: { path: { flowId: first.modified.flow_id } },
                body: { ids: order },
              }),
            );
            return { txid: done.txid };
          }
          const txids = await Promise.all(
            transaction.mutations.map(async (m) => {
              const c = m.changes;
              const saved = await unwrap(
                api.PATCH("/steps/{stepId}", {
                  params: { path: { stepId: m.key as string } },
                  body: {
                    ...(c.kind !== undefined ? { kind: c.kind } : {}),
                    ...(c.text !== undefined ? { text: c.text } : {}),
                    ...(c.expected_result !== undefined ? { expectedResult: c.expected_result } : {}),
                    ...(c.post_state !== undefined ? { postState: c.post_state } : {}),
                    ...(c.device_label !== undefined ? { deviceLabel: c.device_label } : {}),
                  },
                }),
              );
              return saved.txid;
            }),
          );
          return { txid: txids };
        },
        onDelete: async ({ transaction }) => {
          const txids = await Promise.all(
            transaction.mutations.map(async (m) => {
              const gone = await unwrap(
                api.DELETE("/steps/{stepId}", { params: { path: { stepId: m.key as string } } }),
              );
              return gone.txid;
            }),
          );
          return { txid: txids };
        },
      }),
    ),
  );
}

export function flowMarksOf(flowId: string) {
  return memo(`flow_marks:${flowId}`, () =>
    createCollection(
      electricCollectionOptions<StepMarkRow>({
        id: `flow_marks:${flowId}`,
        shapeOptions: { url: shapeUrl("flow.marks"), params: { flowId } },
        getKey: (r) => `${r.step_id}|${r.test_id}`,
        onInsert: async ({ transaction }) => ({
          txid: await Promise.all(
            transaction.mutations.map(async (m) =>
              (await unwrap(
                api.PUT("/steps/{stepId}/marks/{testId}", {
                  params: { path: { stepId: m.modified.step_id, testId: m.modified.test_id } },
                }),
              )).txid,
            ),
          ),
        }),
        onDelete: async ({ transaction }) => ({
          txid: await Promise.all(
            transaction.mutations.map(async (m) =>
              (await unwrap(
                api.DELETE("/steps/{stepId}/marks/{testId}", {
                  params: { path: { stepId: m.original.step_id, testId: m.original.test_id } },
                }),
              )).txid,
            ),
          ),
        }),
      }),
    ),
  );
}
