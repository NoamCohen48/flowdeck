/**
 * Verdicts stay on the tester's machine until they press Finish. Nothing reaches
 * the server — or the board — before then, and Abandon throws the lot away.
 *
 * The draft is kept in localStorage per flow run so a refresh, a crashed tab or
 * a dead battery does not cost three hours of testing. Screenshots are stored
 * already shrunk, as data URLs, which keeps a day's worth under the quota.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Verdict } from "@flowdeck/domain";
import type { StepProblemRow, TestResultRow } from "./collections.ts";

export interface DraftAttachment { name: string; dataUrl: string; width: number; height: number }

export interface DraftResult {
  stepId: string;
  testId: string;
  testVersionId: string;
  verdict: Verdict;
  note: string | null;
  blocking: boolean;
  recordedAt: string;
  attachments: DraftAttachment[];
}

export type Draft = Record<string, DraftResult>;

/** "This step is wrong" (D40), keyed by step. Travels with the verdicts: recorded on Finish, discarded on Abandon. */
export interface DraftProblem {
  stepId: string;
  note: string;
  workaround: string | null;
  blocking: boolean;
  recordedAt: string;
}

export type ProblemDraft = Record<string, DraftProblem>;

const key = (flowRunId: string) => `flowdeck.draft.${flowRunId}`;
const problemsKey = (flowRunId: string) => `flowdeck.draft.${flowRunId}.steps`;
export const draftKey = (stepId: string, testId: string) => `${stepId}|${testId}`;

function load<T extends object>(k: string): T {
  try { return JSON.parse(localStorage.getItem(k) ?? "{}") as T; } catch { return {} as T; }
}

function store(k: string, d: object) {
  try {
    if (Object.keys(d).length) localStorage.setItem(k, JSON.stringify(d));
    else localStorage.removeItem(k);
  } catch { /* quota or private mode: the in-memory copy still works for this session */ }
}

export function useDraftResults(flowRunId: string, recordedBy: string | null) {
  const [draft, setDraft] = useState<Draft>(() => load(key(flowRunId)));
  const [problems, setProblems] = useState<ProblemDraft>(() => load(problemsKey(flowRunId)));
  useEffect(() => { setDraft(load(key(flowRunId))); setProblems(load(problemsKey(flowRunId))); }, [flowRunId]);
  useEffect(() => { store(key(flowRunId), draft); }, [flowRunId, draft]);
  useEffect(() => { store(problemsKey(flowRunId), problems); }, [flowRunId, problems]);

  const set = useCallback((r: Omit<DraftResult, "recordedAt">) => {
    setDraft((d) => ({ ...d, [draftKey(r.stepId, r.testId)]: { ...r, recordedAt: new Date().toISOString() } }));
  }, []);
  const flag = useCallback((p: Omit<DraftProblem, "recordedAt">) => {
    setProblems((d) => ({ ...d, [p.stepId]: { ...p, recordedAt: new Date().toISOString() } }));
  }, []);
  const unflag = useCallback((stepId: string) => {
    setProblems((d) => { const { [stepId]: _, ...rest } = d; return rest; });
  }, []);
  const clear = useCallback(() => {
    setDraft({}); setProblems({});
    store(key(flowRunId), {}); store(problemsKey(flowRunId), {});
  }, [flowRunId]);

  /** The draft in the shape the rest of the runner already understands. */
  const rows = useMemo<TestResultRow[]>(() => Object.values(draft).map((r) => ({
    id: `draft:${r.stepId}:${r.testId}`,
    flow_run_id: flowRunId,
    step_id: r.stepId,
    test_id: r.testId,
    test_version_id: r.testVersionId,
    verdict: r.verdict,
    note: r.note,
    blocking: r.blocking,
    recorded_by: recordedBy ?? "",
    recorded_at: r.recordedAt,
    idempotency_key: `${flowRunId}:${r.stepId}:${r.testId}:${r.verdict}`,
  })), [draft, flowRunId, recordedBy]);

  const problemRows = useMemo<StepProblemRow[]>(() => Object.values(problems).map((p) => ({
    id: `draft:${p.stepId}`,
    flow_run_id: flowRunId,
    step_id: p.stepId,
    note: p.note,
    workaround: p.workaround,
    blocking: p.blocking,
    recorded_by: recordedBy ?? "",
    recorded_at: p.recordedAt,
  })), [problems, flowRunId, recordedBy]);

  return { draft, rows, set, problems, problemRows, flag, unflag, clear, count: Object.keys(draft).length + Object.keys(problems).length };
}

export function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
