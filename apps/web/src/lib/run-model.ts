/**
 * The run as a screen sees it: the immutable snapshot from REST, joined with the
 * live flow runs and results from Electric, and the derived numbers every surface
 * shows. Derivations use @flowdeck/domain so the board, the runner and the API
 * agree on what a number means.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { blockingStepIndex, computeBlocked, worstResultByTest, type Verdict } from "@flowdeck/domain";
import { api, unwrap, type Run, type SnapshotFlow } from "./api.ts";
import { flowRunsOf, resultsOf, stepProblemsOf, type FlowRunRow, type StepProblemRow, type TestResultRow } from "./collections.ts";

/** A day older than a week is not today's: it is one somebody forgot to close. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const isStale = (run: { date: string; closedAt: string | null }) =>
  !run.closedAt && Date.now() - new Date(run.date).getTime() >= STALE_AFTER_MS;

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => unwrap(api.GET("/runs/{runId}", { params: { path: { runId } } })),
    // The snapshot never changes (D21). Flow runs and results come live.
    staleTime: Infinity,
    select: (r: Run) => r,
  });
}

export function useLiveFlowRuns(runId: string) {
  const coll = flowRunsOf(runId);
  const q = useLiveQuery(() => coll, [coll]);
  return { rows: (q.data ?? []) as FlowRunRow[], ready: q.isReady };
}

export function useLiveResults(runId: string) {
  const coll = resultsOf(runId);
  const q = useLiveQuery(() => coll, [coll]);
  return { rows: (q.data ?? []) as TestResultRow[], ready: q.isReady };
}

export function useLiveStepProblems(runId: string) {
  const coll = stepProblemsOf(runId);
  const q = useLiveQuery(() => coll, [coll]);
  return { rows: (q.data ?? []) as StepProblemRow[], ready: q.isReady };
}

export interface FlowProgress {
  flow: SnapshotFlow;
  flowRuns: FlowRunRow[];
  /** Tests this flow marks, distinct. */
  testCount: number;
  /** Tests with at least one result across every FlowRun of this flow. */
  reached: number;
  counts: Record<Verdict, number>;
  state: "open" | "running" | "done";
  holders: string[];
}

export function progressOf(
  flow: SnapshotFlow,
  flowRuns: FlowRunRow[],
  results: TestResultRow[],
): FlowProgress {
  const mine = flowRuns.filter((fr) => fr.flow_id === flow.id);
  const ids = new Set(mine.map((fr) => fr.id));
  const relevant = results.filter((r) => ids.has(r.flow_run_id));
  const tests = new Set(flow.steps.flatMap((s) => s.marks));
  const worst = worstResultByTest(
    relevant.map((r) => ({ testId: r.test_id, verdict: r.verdict })),
  );
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, minor: 0, skipped: 0 };
  for (const v of worst.values()) counts[v] += 1;

  const claimed = mine.filter((fr) => fr.state === "claimed");
  const finished = mine.filter((fr) => fr.state === "finished");
  const state = claimed.length ? "running" : finished.length ? "done" : "open";
  return {
    flow,
    flowRuns: mine,
    testCount: tests.size,
    reached: worst.size,
    counts,
    state,
    holders: [...new Set(claimed.map((fr) => fr.claimed_by).filter((n): n is string => !!n))],
  };
}

/** Everything the testing-day board and its footer need. */
export function useRunBoard(runId: string) {
  const run = useRun(runId);
  const { rows: flowRuns } = useLiveFlowRuns(runId);
  const { rows: results } = useLiveResults(runId);

  return useMemo(() => {
    if (!run.data) return undefined;
    const snapshot = run.data.snapshot;
    const flows = snapshot.flows.map((f) => progressOf(f, flowRuns, results));
    const everyTest = new Set(snapshot.flows.flatMap((f) => f.steps.flatMap((s) => s.marks)));
    const worst = worstResultByTest(
      results.map((r) => ({ testId: r.test_id, verdict: r.verdict })),
    );
    const counts: Record<Verdict, number> = { pass: 0, fail: 0, minor: 0, skipped: 0 };
    for (const v of worst.values()) counts[v] += 1;
    return {
      run: run.data,
      flows,
      counts,
      total: everyTest.size,
      notReached: everyTest.size - worst.size,
    };
  }, [run.data, flowRuns, results]);
}

/**
 * One tester's view of one flow: their results, the steps they flagged as wrong
 * (D40), and what a blocking failure or a step they could not get past closed.
 */
export function flowRunView(flow: SnapshotFlow, flowRunId: string, results: TestResultRow[], problems: StepProblemRow[] = []) {
  const mine = results.filter((r) => r.flow_run_id === flowRunId);
  const byStepTest = new Map<string, TestResultRow>();
  for (const r of mine) byStepTest.set(`${r.step_id}|${r.test_id}`, r);
  const problemByStep = new Map<string, StepProblemRow>();
  for (const p of problems) if (p.flow_run_id === flowRunId) problemByStep.set(p.step_id, p);

  const blocked = computeBlocked(flow.steps, blockingStepIndex(flow.steps, [
    ...mine.filter((r) => r.verdict === "fail").map((r) => ({ stepId: r.step_id, blocking: r.blocking })),
    ...[...problemByStep.values()].map((p) => ({ stepId: p.step_id, blocking: p.blocking })),
  ]));

  // The step the tester is "on": the first with a marked test lacking a verdict.
  const currentIndex = (() => {
    for (const [i, s] of flow.steps.entries()) {
      if (blocked.blockedStepIds.has(s.id)) return i;
      if (s.marks.some((t) => !byStepTest.has(`${s.id}|${t}`))) return i;
    }
    return flow.steps.length;
  })();

  const counts: Record<Verdict, number> = { pass: 0, fail: 0, minor: 0, skipped: 0 };
  for (const r of mine) counts[r.verdict] += 1;
  const total = new Set(flow.steps.flatMap((s) => s.marks)).size;

  return { mine, byStepTest, problemByStep, blocked, currentIndex, counts, total, remaining: total - mine.length };
}
