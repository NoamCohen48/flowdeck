/**
 * The flow as the editor sees it: live steps and marks from Electric, joined
 * into the same step shape the runner renders, so hand-offs are recomputed by
 * the one function in @flowdeck/domain after every insert, edit and drag.
 */
import { useMemo } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type SnapshotStep, type Test } from "./api.ts";
import { flowMarksOf, marksOf, stepsOf, testsOf, type StepRow } from "./collections.ts";

export function useEditorSteps(flowId: string) {
  const steps = stepsOf(flowId);
  const marks = flowMarksOf(flowId);
  const s = useLiveQuery(() => steps, [steps]);
  const m = useLiveQuery(() => marks, [marks]);

  const ordered = useMemo<SnapshotStep[]>(() => {
    const byStep = new Map<string, string[]>();
    for (const mark of (m.data ?? []) as { step_id: string; test_id: string }[]) {
      const list = byStep.get(mark.step_id) ?? [];
      list.push(mark.test_id);
      byStep.set(mark.step_id, list);
    }
    return [...((s.data ?? []) as StepRow[])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((r) => ({
        id: r.id,
        position: r.position,
        kind: r.kind,
        text: r.text,
        expectedResult: r.expected_result,
        postState: r.post_state,
        deviceLabel: r.device_label,
        marks: byStep.get(r.id) ?? [],
      }));
  }, [s.data, m.data]);

  return { steps: ordered, ready: s.isReady && m.isReady, collection: steps, marks };
}

/** The product's tests by id, archived included — a mark on an archived test still needs a title. */
export function useTestIndex(productId: string) {
  const q = useQuery({
    queryKey: ["tests", productId, "all"],
    queryFn: () =>
      unwrap(api.GET("/products/{productId}/tests", { params: { path: { productId }, query: { includeArchived: "true" } } })),
  });
  const byId = useMemo(() => new Map((q.data ?? []).map((t) => [t.id, t])), [q.data]);
  return { tests: (q.data ?? []) as Test[], byId, ready: q.isSuccess };
}

/**
 * Live coverage for the picker: how many steps mark each test right now, across
 * the whole product. Zero is the number an author is looking for (D2).
 */
export function useLiveCoverage(productId: string) {
  const marks = marksOf(productId);
  const tests = testsOf(productId);
  const m = useLiveQuery(() => marks, [marks]);
  const t = useLiveQuery(() => tests, [tests]);
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const row of (m.data ?? []) as { test_id: string }[]) count.set(row.test_id, (count.get(row.test_id) ?? 0) + 1);
    const archived = new Set(((t.data ?? []) as { id: string; archived: boolean | string }[]).filter((x) => x.archived === true || x.archived === "true").map((x) => x.id));
    return { markCount: (id: string) => count.get(id) ?? 0, isArchived: (id: string) => archived.has(id), ready: m.isReady && t.isReady };
  }, [m.data, t.data, m.isReady, t.isReady]);
}
