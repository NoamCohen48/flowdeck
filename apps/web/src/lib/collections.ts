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
