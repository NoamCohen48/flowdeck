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
import type { TestResultRow } from "./collections.ts";

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

const key = (flowRunId: string) => `flowdeck.draft.${flowRunId}`;
export const draftKey = (stepId: string, testId: string) => `${stepId}|${testId}`;

function load(flowRunId: string): Draft {
  try { return JSON.parse(localStorage.getItem(key(flowRunId)) ?? "{}") as Draft; } catch { return {}; }
}

function store(flowRunId: string, d: Draft) {
  try {
    if (Object.keys(d).length) localStorage.setItem(key(flowRunId), JSON.stringify(d));
    else localStorage.removeItem(key(flowRunId));
  } catch { /* quota or private mode: the in-memory copy still works for this session */ }
}

export function useDraftResults(flowRunId: string, recordedBy: string | null) {
  const [draft, setDraft] = useState<Draft>(() => load(flowRunId));
  useEffect(() => { setDraft(load(flowRunId)); }, [flowRunId]);
  useEffect(() => { store(flowRunId, draft); }, [flowRunId, draft]);

  const set = useCallback((r: Omit<DraftResult, "recordedAt">) => {
    setDraft((d) => ({ ...d, [draftKey(r.stepId, r.testId)]: { ...r, recordedAt: new Date().toISOString() } }));
  }, []);
  const clear = useCallback(() => { setDraft({}); store(flowRunId, {}); }, [flowRunId]);

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

  return { draft, rows, set, clear, count: Object.keys(draft).length };
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
