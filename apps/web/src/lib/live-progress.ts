/**
 * The tester's draft, summarised for the board while they run a flow (D42).
 *
 * Verdicts stay on this device until Finish (see draft-results.ts). This is the
 * one thing that leaves early: where the tester is, a tally, and every non-pass
 * with its note, so a coordinator sees a blocking failure on step 3 when it
 * happens rather than when the flow is finished. The board shows it as in
 * flight and never counts it; Finish and Abandon clear it on the server.
 */
import { useEffect, useMemo, useRef } from "react";
import { worstResultByTest, type LiveIssue, type LiveProgress, type Verdict } from "@flowdeck/domain";
import { api, type SnapshotFlow } from "./api.ts";
import type { StepProblemRow } from "./collections.ts";
import type { flowRunView } from "./run-model.ts";

type View = ReturnType<typeof flowRunView>;

export function liveProgressOf(flow: SnapshotFlow, view: View, problems: StepProblemRow[]): Omit<LiveProgress, "updatedAt"> {
  const order = new Map(flow.steps.map((s, i) => [s.id, i]));
  // Anything drafted on a step a later blocking report closed is void, as on Finish.
  const live = view.mine.filter((r) => !view.blocked.blockedStepIds.has(r.step_id));
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, minor: 0, skipped: 0 };
  for (const v of worstResultByTest(live.map((r) => ({ testId: r.test_id, verdict: r.verdict }))).values()) counts[v] += 1;

  const issues: LiveIssue[] = [
    ...live
      .filter((r) => r.verdict !== "pass")
      .map((r) => ({ step: order.get(r.step_id) ?? 0, testId: r.test_id, kind: r.verdict as LiveIssue["kind"], note: r.note ?? "", blocking: r.blocking })),
    ...problems
      .filter((p) => !view.blocked.blockedStepIds.has(p.step_id))
      .map((p) => ({ step: order.get(p.step_id) ?? 0, testId: null, kind: "flag" as const, note: p.note, blocking: p.blocking })),
  ].sort((a, b) => a.step - b.step);

  return {
    step: Math.min(view.currentIndex, Math.max(flow.steps.length - 1, 0)),
    total: view.total,
    counts,
    blockedFrom: view.blocked.blockedFromIndex ?? null,
    issues,
  };
}

/**
 * Publishes `progress` whenever it changes, a moment after the tester stops
 * tapping. Fire and forget: a missed update is corrected by the next one, and the
 * draft on this device is the record either way.
 */
export function usePublishProgress(flowRunId: string, progress: Omit<LiveProgress, "updatedAt"> | null) {
  const key = useMemo(() => (progress ? JSON.stringify(progress) : null), [progress]);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!key || key === sent.current) return;
    const t = setTimeout(() => {
      sent.current = key;
      void api.PUT("/flow-runs/{flowRunId}/progress", {
        params: { path: { flowRunId } },
        // The key is the progress itself, serialised; parsing it back gives a plain copy.
        body: { ...(JSON.parse(key) as Omit<LiveProgress, "updatedAt">), updatedAt: new Date().toISOString() },
      }).catch(() => { sent.current = null; });
    }, 600);
    return () => clearTimeout(t);
  }, [flowRunId, key]);
}
