/**
 * The flow runner (`.docs/03-execution.md`). One long list; no pagination, no
 * wizard, no collapsing. The tester's mental model is "I am walking down a list".
 *
 * Verdicts are a local draft until Finish: only then are they recorded, so an
 * abandoned flow leaves nothing behind and the board never shows half a run.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  computeHandoffs,
  devicesInPlayAt,
  type DeviceAssignment,
  type Verdict,
} from "@flowdeck/domain";
import { api, unwrap, type SnapshotFlow, type SnapshotStep, type TemplateSnapshot } from "../lib/api.ts";
import type { TestResultRow } from "../lib/collections.ts";
import { dataUrlToBlob, fileToDataUrl, useDraftResults } from "../lib/draft-results.ts";
import { flowRunView, useLiveFlowRuns, useLiveResults, useRun } from "../lib/run-model.ts";
import { useMe } from "../lib/identity.tsx";
import { usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { shrinkImage } from "../lib/images.ts";
import { DeviceBar, DeviceChip, Pickup, deviceStyle } from "../components/Device.tsx";
import { VerdictButtons, noteClass } from "../components/Verdicts.tsx";
import { Bar, Legend } from "../components/Progress.tsx";
import { VerdictDialog, type VerdictSubmission } from "../components/VerdictDialog.tsx";
import { StepMap } from "../components/StepMap.tsx";
import { KindBadge, TestsIcon } from "../components/Step.tsx";

export function Runner() {
  const { productId, runId, flowRunId } = useParams({ strict: false }) as {
    productId: string;
    runId: string;
    flowRunId: string;
  };
  const run = useRun(runId);
  const { rows: flowRuns } = useLiveFlowRuns(runId);
  const { rows: results, ready } = useLiveResults(runId);
  // The live row wins; the REST copy only bridges the first render before the
  // stream is ready. Both are normalised to one shape here and nowhere else.
  const live = flowRuns.find((fr) => fr.id === flowRunId);
  const rest = run.data?.flowRuns.find((fr) => fr.id === flowRunId);
  const flowRun = live
    ? { flowId: live.flow_id, claimedBy: live.claimed_by, state: live.state, startedAt: live.started_at, finishedAt: live.finished_at }
    : rest
      ? { flowId: rest.flowId, claimedBy: rest.claimedBy, state: rest.state, startedAt: rest.startedAt, finishedAt: rest.finishedAt }
      : undefined;
  const flow = run.data?.snapshot.flows.find((f) => f.id === flowRun?.flowId);

  usePresence(`run:${runId}`);
  useTitle(flow ? `${flow.name} — Flowdeck` : "Flowdeck");

  if (run.isPending || !ready) return <main className="shell"><p className="meta">Loading the flow…</p></main>;
  if (!run.data || !flowRun || !flow) return <main className="shell"><p className="note">This flow run does not exist.</p></main>;

  return (
    <RunnerBody
      productId={productId}
      runId={runId}
      flowRunId={flowRunId}
      claimedBy={flowRun.claimedBy}
      state={flowRun.state}
      startedAt={flowRun.startedAt}
      finishedAt={flowRun.finishedAt}
      snapshot={run.data.snapshot}
      flow={flow}
      results={results}
    />
  );
}

function RunnerBody({
  productId,
  runId,
  flowRunId,
  claimedBy,
  state,
  startedAt,
  finishedAt,
  snapshot,
  flow,
  results,
}: {
  productId: string;
  runId: string;
  flowRunId: string;
  claimedBy: string | null;
  state: string;
  startedAt: string;
  finishedAt: string | null;
  snapshot: TemplateSnapshot;
  flow: SnapshotFlow;
  results: TestResultRow[];
}) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const handoffs = useMemo(() => computeHandoffs(flow.steps), [flow.steps]);
  const readOnly = state !== "claimed";
  const isMine = claimedBy === me.name;
  const editable = !readOnly && isMine;

  // My own claimed run reads from the draft; anyone else's (or a finished one) from what was recorded.
  const draft = useDraftResults(flowRunId, me.name);
  const rows = editable ? draft.rows : results;
  const view = useMemo(() => flowRunView(flow, flowRunId, rows), [flow, flowRunId, rows]);
  const testTitle = useCallback(
    (id: string) => snapshot.tests.find((t) => t.id === id)?.title ?? "(archived test)",
    [snapshot.tests],
  );

  // The step the keyboard is on; follows the tester's real position unless they move it.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const current = focusIndex ?? Math.min(view.currentIndex, flow.steps.length - 1);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  const [dialog, setDialog] = useState<{ step: SnapshotStep; testId: string; verdict: Verdict } | null>(null);
  const [committing, setCommitting] = useState<string | null>(null);

  // Leaving with unrecorded verdicts — in-app navigation or closing the tab — asks first.
  const leaving = useRef(false);
  const dirty = editable && draft.count > 0 && !leaving.current;
  useBlocker({
    shouldBlockFn: () => dirty && !confirm(`You have ${draft.count} unrecorded verdict${draft.count === 1 ? "" : "s"}. Leave without finishing? They stay on this device until you come back.`),
    enableBeforeUnload: () => dirty,
  });

  function record(step: SnapshotStep, testId: string, verdict: Verdict, note: string | null, blocking: boolean, attachments: { name: string; dataUrl: string; width: number; height: number }[] = []) {
    const test = snapshot.tests.find((t) => t.id === testId);
    if (!test || !me.name) return;
    draft.set({ stepId: step.id, testId, testVersionId: test.versionId, verdict, note, blocking, attachments });
  }

  function pick(step: SnapshotStep, testId: string, verdict: Verdict) {
    if (!editable || view.blocked.blockedStepIds.has(step.id)) return;
    if (verdict === "pass") {
      record(step, testId, "pass", null, false);
    } else {
      setDialog({ step, testId, verdict });
    }
  }

  async function submitDialog(s: VerdictSubmission) {
    if (!dialog) return;
    const attachments = [];
    for (const file of s.files) {
      const { blob, width, height } = await shrinkImage(file);
      attachments.push({ name: file.name.replace(/\.[^.]+$/, ".webp"), dataUrl: await fileToDataUrl(blob), width, height });
    }
    record(dialog.step, dialog.testId, s.verdict, s.note || null, s.blocking, attachments);
    setDialog(null);
  }

  function passAll(step: SnapshotStep) {
    if (!editable || view.blocked.blockedStepIds.has(step.id)) return;
    for (const testId of step.marks) {
      if (!view.byStepTest.get(`${step.id}|${testId}`)) record(step, testId, "pass", null, false);
    }
  }

  /** Finish records every drafted verdict, in step order, then closes the flow run. */
  async function finish() {
    // A blocking fail recorded after later steps were passed: those verdicts are void (D11).
    const entries = Object.values(draft.draft).filter((r) => !view.blocked.blockedStepIds.has(r.stepId));
    const order = new Map(flow.steps.map((st, i) => [st.id, i]));
    entries.sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
    const unverified = view.remaining;
    if (unverified && !confirm(`${unverified} test${unverified === 1 ? "" : "s"} still ${unverified === 1 ? "has" : "have"} no verdict and will report as not reached. Finish anyway?`)) return;
    try {
      for (const [i, r] of entries.entries()) {
        setCommitting(`Recording ${i + 1} of ${entries.length}…`);
        const recorded = await unwrap(api.POST("/flow-runs/{flowRunId}/results", {
          params: { path: { flowRunId } },
          body: { stepId: r.stepId, testId: r.testId, verdict: r.verdict, note: r.note, blocking: r.blocking, idempotencyKey: `${flowRunId}:${r.stepId}:${r.testId}:${r.verdict}` },
        }));
        for (const a of r.attachments) {
          const form = new FormData();
          form.set("file", new File([await dataUrlToBlob(a.dataUrl)], a.name, { type: "image/webp" }));
          form.set("width", String(a.width));
          form.set("height", String(a.height));
          await fetch(`/api/results/${recorded.id}/attachments`, { method: "POST", body: form });
        }
      }
      setCommitting("Finishing…");
      await unwrap(api.POST("/flow-runs/{flowRunId}/finish", { params: { path: { flowRunId } } }));
    } catch (e) {
      setCommitting(null);
      alert(`Could not record the results: ${e instanceof Error ? e.message : String(e)}. Nothing is lost — try again.`);
      return;
    }
    leaving.current = true;
    draft.clear();
    await qc.invalidateQueries({ queryKey: ["run", runId] });
    void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId } });
  }

  async function abandon() {
    const n = draft.count;
    if (!confirm(`Abandon this flow?${n ? ` Your ${n} verdict${n === 1 ? " is" : "s are"} discarded.` : ""} The next person starts it from step 1.`)) return;
    leaving.current = true;
    draft.clear();
    await unwrap(api.POST("/flow-runs/{flowRunId}/abandon", { params: { path: { flowRunId } } }));
    await qc.invalidateQueries({ queryKey: ["run", runId] });
    void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId } });
  }

  const scrollTo = useCallback((i: number) => {
    setFocusIndex(i);
    stepRefs.current[i]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // Keyboard-driven runner (I2). Four hours and several hundred steps on a laptop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (dialog || t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      const step = flow.steps[current];
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); scrollTo(Math.min(current + 1, flow.steps.length - 1)); break;
        case "k": case "ArrowUp": e.preventDefault(); scrollTo(Math.max(current - 1, 0)); break;
        case "p": if (step) { step.marks.length ? passAll(step) : scrollTo(Math.min(current + 1, flow.steps.length - 1)); } break;
        case "f": if (step?.marks[0]) pick(step, step.marks[0], "fail"); break;
        case "m": if (step?.marks[0]) pick(step, step.marks[0], "minor"); break;
        case "s": if (step?.marks[0]) pick(step, step.marks[0], "skipped"); break;
        case "g": scrollTo(Math.min(view.currentIndex, flow.steps.length - 1)); setFocusIndex(null); break;
        case "?": setHelp((h) => !h); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const [help, setHelp] = useState(false);

  const devicesInPlay = devicesInPlayAt(handoffs, current);

  return (
    <main className="shell wide">
      <p className="crumb">
        <Link to="/products/$productId/runs/$runId" params={{ productId, runId }} className="lnk">
          Testing day · {snapshot.name}
        </Link>{" "}
        › <span dir="auto">{flow.name}</span>
      </p>

      {!editable ? (
        <RunBanner state={state} by={claimedBy} startedAt={startedAt} finishedAt={finishedAt} mine={isMine} counts={view.counts} total={view.total} />
      ) : null}

      <div className="flowhead">
        <div className="row-split">
          <div>
            <h1 style={{ fontSize: 22 }} dir="auto">{flow.name}</h1>
            <p className="meta" style={{ margin: "2px 0 0" }}>
              {editable ? `Claimed by you` : readOnly ? `Run by ${claimedBy ?? "nobody"}` : `Claimed by ${claimedBy}`} · {flow.steps.length} steps
              {flow.estimatedMinutes ? ` · ~${flow.estimatedMinutes} min` : ""}
            </p>
          </div>
          {!readOnly && isMine ? (
            <div className="flex gap-2">
              <button className="btn" onClick={() => setHelp((h) => !h)} title="Keyboard shortcuts">
                <span className="kbd">?</span>
              </button>
              <button className="btn danger" onClick={() => void abandon()}>Abandon flow</button>
            </div>
          ) : null}
        </div>
        {flow.precondition ? (
          <div className="pre" dir="auto"><b>Before you start:</b> {flow.precondition}</div>
        ) : null}
        <div className="flex gap-2 items-center flex-wrap mt-3">
          <span className="meta">Devices used:</span>
          {handoffs.devices.map((d) => <DeviceChip key={d.label} device={d} ghost />)}
        </div>
        {help ? <ShortcutHelp /> : null}
      </div>

      <DeviceBar devices={devicesInPlay} />

      <div className="grid gap-6 grid-cols-1 md:grid-cols-[minmax(0,1fr)_272px]">
        <ol className="steps">
          {flow.steps.map((step, i) => {
            const intro = handoffs.introductions.get(step.id);
            const device = handoffs.byLabel.get(step.deviceLabel)!;
            const blocked = view.blocked.blockedStepIds.has(step.id);
            const done = step.marks.length > 0 && step.marks.every((t) => view.byStepTest.has(`${step.id}|${t}`));
            return (
              <li key={step.id} ref={(el) => { stepRefs.current[i] = el; }} style={deviceStyle(device.slot)}>
                {intro && i > 0 ? <Pickup device={intro} /> : null}
                {intro && i === 0 ? <div className="hand">Start on <DeviceChip device={intro} /></div> : null}
                <StepCard
                  step={step}
                  index={i}
                  device={device}
                  isCurrent={i === current}
                  done={done}
                  blocked={blocked}
                  readOnly={readOnly || !isMine}
                  results={view.byStepTest}
                  testTitle={testTitle}
                  onPick={(testId, v) => pick(step, testId, v)}
                  onPassAll={() => passAll(step)}
                  onFocus={() => setFocusIndex(i)}
                />
              </li>
            );
          })}
        </ol>
        {/* The "in your hands" bar is sticky above; the map sits below it. */}
        <aside className="hidden md:block" style={{ "--map-top": "124px" } as React.CSSProperties}>
          <StepMap
            steps={flow.steps}
            handoffs={handoffs}
            current={current}
            onJump={scrollTo}
            isDone={(s) => s.marks.length > 0 && s.marks.every((t) => view.byStepTest.has(`${s.id}|${t}`))}
          />
        </aside>
      </div>

      {view.blocked.blockedFromIndex !== undefined ? (
        <p className="note" style={{ marginLeft: 0 }}>
          Blocked from step {view.blocked.blockedFromIndex + 1}. {view.blocked.unverifiedTestIds.size} tests will report as not reached.
        </p>
      ) : null}

      <div className="hand">End of flow</div>
      {editable ? (
        <div className="finishbox">
          <b>Finish to record your verdicts</b>
          <span className="meta">{draft.count ? `${draft.count} verdict${draft.count === 1 ? "" : "s"} on this device, not yet on the board.` : "Nothing recorded yet."} Abandoning discards them.</span>
          <button className="btn primary" disabled={!!committing} onClick={() => void finish()}>{committing ?? "Finish flow"}</button>
        </div>
      ) : null}

      <div className="runfoot">
        <span className="meta">
          {view.total - view.remaining} of {view.total} tests · {view.remaining} remaining
        </span>
        <Bar counts={view.counts} total={view.total} />
        <Legend />
        <button className="btn sm" onClick={() => { scrollTo(Math.min(view.currentIndex, flow.steps.length - 1)); setFocusIndex(null); }}>
          Jump to current
        </button>
      </div>

      <VerdictDialog
        verdict={dialog?.verdict ?? null}
        testTitle={dialog ? testTitle(dialog.testId) : ""}
        onSubmit={submitDialog}
        onCancel={() => setDialog(null)}
      />
    </main>
  );
}

function StepCard({
  step, index, device, isCurrent, done, blocked, readOnly, results, testTitle, onPick, onPassAll, onFocus,
}: {
  step: SnapshotStep;
  index: number;
  device: DeviceAssignment;
  isCurrent: boolean;
  done: boolean;
  blocked: boolean;
  readOnly: boolean;
  results: Map<string, TestResultRow>;
  testTitle: (id: string) => string;
  onPick: (testId: string, v: Verdict) => void;
  onPassAll: () => void;
  onFocus: () => void;
}) {
  const isCheck = step.kind === "assertion";
  return (
    <div
      className={`step${isCurrent ? " now" : ""}${done ? " done" : ""}${blocked ? " blocked" : ""}`}
      id={`step-${step.id}`}
      onClick={onFocus}
      aria-current={isCurrent ? "step" : undefined}
    >
      <div className="sline">
        <span className="snum">{index + 1}</span>
        <DeviceChip device={device} />
        <KindBadge kind={step.kind} long />
        {blocked ? <span className="tag">Blocked</span> : null}
      </div>
      <div className="stop">
        <p className="stext" dir="auto">{step.text}</p>
      </div>
      {isCheck && step.expectedResult ? (
        <div className="expect" dir="auto"><b>Expected:</b> {step.expectedResult}</div>
      ) : null}

      {step.marks.length ? (
        <div className="tests">
          <div className="cap"><TestsIcon />This step verifies {step.marks.length === 1 ? "1 test" : `${step.marks.length} tests`}</div>
          {step.marks.map((testId) => {
            const r = results.get(`${step.id}|${testId}`);
            return (
              <div className="trow" key={testId}>
                <span className="tname" dir="auto">{testTitle(testId)}</span>
                <VerdictButtons value={r?.verdict} disabled={readOnly || blocked} onPick={(v) => onPick(testId, v)} />
                {r?.note ? (
                  <div className={noteClass(r.verdict)} dir="auto">
                    {r.note}
                    {r.verdict === "fail" ? <span className="meta"> · {r.blocking ? "Blocked the rest of the flow" : "Not blocking"}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!readOnly && !blocked && !done ? (
            <div className="stepfoot">
              <button className="btn sm" onClick={onPassAll}>
                Pass all <span className="kbd" style={{ marginLeft: 6 }}>p</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Someone else's flow, or one already over: say whose it is and when, before
 * a single step is read — the verdict buttons below are disabled and that
 * needs an explanation, not a discovery.
 */
function RunBanner({ state, by, startedAt, finishedAt, mine, counts, total }: {
  state: string; by: string | null; startedAt: string; finishedAt: string | null; mine: boolean;
  counts: Record<Verdict, number>; total: number;
}) {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  };
  const who = mine ? "you" : by ?? "nobody";
  const reached = counts.pass + counts.fail + counts.minor + counts.skipped;
  const headline =
    state === "finished" ? `Finished by ${who}${finishedAt ? ` on ${fmt(finishedAt)}` : ""}`
    : state === "abandoned" ? `Abandoned by ${who}${finishedAt ? ` on ${fmt(finishedAt)}` : ""}`
    : state === "claimed" ? `${by ?? "Someone"} is running this flow right now`
    : "Nobody is running this flow";
  const cls = state === "finished" ? (counts.fail ? "fail" : "pass") : state === "abandoned" ? "skip" : "open";
  return (
    <div className={`runbanner ${cls}`} role="status">
      <span className="avatar" aria-hidden>{(by ?? "?").trim().charAt(0).toUpperCase()}</span>
      <div className="body">
        <b>{headline}</b>
        <span className="meta">
          Started {fmt(startedAt)}
          {state === "finished" || state === "abandoned" ? ` · ${reached} of ${total} tests reached` : ""}
          {" · "}read-only — {state === "claimed" ? "only the person who claimed a flow can record verdicts" : "results cannot be changed after a flow is over"}
        </span>
      </div>
      {state === "finished" || state === "abandoned" ? (
        <span className="tally">
          <span className="pill pass"><span className="dot" />{counts.pass}</span>
          <span className={`pill fail${counts.fail ? "" : " off"}`}><span className="dot" />{counts.fail}</span>
          <span className={`pill minor${counts.minor ? "" : " off"}`}><span className="dot" />{counts.minor}</span>
          <span className={`pill skip${counts.skipped ? "" : " off"}`}><span className="dot" />{counts.skipped}</span>
        </span>
      ) : null}
    </div>
  );
}

function ShortcutHelp() {
  const rows: [string, string][] = [
    ["j / k", "next / previous step"],
    ["p", "pass all tests on this step"],
    ["f", "fail the first test on this step"],
    ["m", "minor issue on the first test"],
    ["s", "skip — the test is wrong"],
    ["g", "jump to where you are"],
    ["?", "toggle this help"],
  ];
  return (
    <div className="pre" style={{ marginTop: 12 }}>
      <b>Keyboard</b>
      <ul className="m-0 mt-1 p-0 list-none grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {rows.map(([k, d]) => (
          <li key={k}><span className="kbd">{k}</span> <span className="meta">{d}</span></li>
        ))}
      </ul>
    </div>
  );
}
