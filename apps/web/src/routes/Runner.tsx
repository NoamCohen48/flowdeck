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
import type { StepProblemRow, TestResultRow } from "../lib/collections.ts";
import { dataUrlToBlob, fileToDataUrl, useDraftResults } from "../lib/draft-results.ts";
import { flowRunView, progressOf, useLiveFlowRuns, useLiveResults, useLiveStepProblems, useRun } from "../lib/run-model.ts";
import { useMe } from "../lib/identity.tsx";
import { usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { shrinkImage } from "../lib/images.ts";
import { DeviceBar, DeviceChip, Pickup, deviceStyle } from "../components/Device.tsx";
import { VerdictButtons, noteClass } from "../components/Verdicts.tsx";
import { Bar, Legend } from "../components/Progress.tsx";
import { VerdictDialog, type VerdictSubmission } from "../components/VerdictDialog.tsx";
import { StepMap } from "../components/StepMap.tsx";
import { FlagIcon, KindBadge, PostState, StepProblemNote, TestsIcon } from "../components/Step.tsx";
import { StepProblemDialog, type StepProblemSubmission } from "../components/StepProblemDialog.tsx";
import { useClaim } from "../components/ClaimDialog.tsx";

export function Runner() {
  const { productId, runId, flowRunId } = useParams({ strict: false }) as {
    productId: string;
    runId: string;
    flowRunId: string;
  };
  const run = useRun(runId);
  const { rows: flowRuns } = useLiveFlowRuns(runId);
  const { rows: results, ready } = useLiveResults(runId);
  const { rows: stepProblems } = useLiveStepProblems(runId);
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

  // The next flow nobody has taken, in template order after this one, wrapping
  // round — so "finish and take the next" walks the board top to bottom.
  const nextFlow = useMemo(() => {
    const flows = run.data?.snapshot.flows ?? [];
    const at = flows.findIndex((f) => f.id === flow?.id);
    if (at === -1) return null;
    const rotated = [...flows.slice(at + 1), ...flows.slice(0, at)];
    return rotated.find((f) => progressOf(f, flowRuns, results).state === "open") ?? null;
  }, [run.data, flow?.id, flowRuns, results]);

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
      stepProblems={stepProblems}
      nextFlow={nextFlow}
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
  stepProblems,
  nextFlow,
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
  stepProblems: StepProblemRow[];
  nextFlow: SnapshotFlow | null;
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
  const problems = editable ? draft.problemRows : stepProblems;
  const view = useMemo(() => flowRunView(flow, flowRunId, rows, problems), [flow, flowRunId, rows, problems]);
  const testTitle = useCallback(
    (id: string) => snapshot.tests.find((t) => t.id === id)?.title ?? "(archived test)",
    [snapshot.tests],
  );

  // The step the keyboard is on; follows the tester's real position unless they move it.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const current = focusIndex ?? Math.min(view.currentIndex, flow.steps.length - 1);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  const [dialog, setDialog] = useState<{ step: SnapshotStep; testId: string; verdict: Verdict } | null>(null);
  const [flagging, setFlagging] = useState<SnapshotStep | null>(null);
  const [committing, setCommitting] = useState<string | null>(null);

  // Leaving with unrecorded verdicts — in-app navigation or closing the tab — asks first.
  const leaving = useRef(false);
  const dirty = editable && draft.count > 0 && !leaving.current;
  useBlocker({
    shouldBlockFn: () => dirty && !confirm(`You have ${draft.count} unrecorded ${draft.count === 1 ? "verdict or flagged step" : "verdicts and flagged steps"}. Leave without finishing? They stay on this device until you come back.`),
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

  // "This step is wrong" (D40): a draft like any verdict, recorded on Finish.
  function flagStep(step: SnapshotStep) {
    if (!editable || view.blocked.blockedStepIds.has(step.id) || view.problemByStep.has(step.id)) return;
    setFlagging(step);
  }

  function submitFlag(s: StepProblemSubmission) {
    if (!flagging) return;
    draft.flag({ stepId: flagging.id, ...s });
    setFlagging(null);
  }

  function passAll(step: SnapshotStep) {
    if (!editable || view.blocked.blockedStepIds.has(step.id)) return;
    for (const testId of step.marks) {
      if (!view.byStepTest.get(`${step.id}|${testId}`)) record(step, testId, "pass", null, false);
    }
  }

  // Marked tests on unblocked steps that still have no verdict: what "pass the
  // rest" would pass, and what plain Finish reports as not reached.
  const pending = useMemo(
    () => flow.steps
      .filter((st) => !view.blocked.blockedStepIds.has(st.id))
      .flatMap((st) => st.marks.filter((t) => !view.byStepTest.has(`${st.id}|${t}`)).map((testId) => ({ step: st, testId }))),
    [flow.steps, view.blocked.blockedStepIds, view.byStepTest],
  );

  // Where Finish goes afterwards: the board, or straight into the next flow
  // nobody has taken. Remembered per device; a tester picks once for the day.
  const [takeNext, setTakeNext] = useState(() => { try { return localStorage.getItem("flowdeck.takeNext") === "1"; } catch { return false; } });
  const goNext = takeNext && nextFlow !== null;
  const chooseNext = (v: boolean) => { setTakeNext(v); try { localStorage.setItem("flowdeck.takeNext", v ? "1" : "0"); } catch { /* fine */ } };
  const toBoard = () => void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId } });
  const { claim, dialog: claimDialog } = useClaim(runId, { onDismiss: toBoard });
  const toFlowRun = (id: string) => void navigate({ to: "/products/$productId/runs/$runId/flows/$flowRunId", params: { productId, runId, flowRunId: id } });

  /**
   * Finish records every drafted verdict, in step order, then closes the flow
   * run. With `passRest`, every test still waiting on an unblocked step is
   * recorded as passed first — the one-click ending for a flow that went fine.
   */
  async function finish(passRest = false) {
    // A blocking fail recorded after later steps were passed: those verdicts are void (D11).
    const entries = Object.values(draft.draft).filter((r) => !view.blocked.blockedStepIds.has(r.stepId));
    if (passRest) {
      for (const { step, testId } of pending) {
        const test = snapshot.tests.find((t) => t.id === testId);
        if (test) entries.push({ stepId: step.id, testId, testVersionId: test.versionId, verdict: "pass", note: null, blocking: false, recordedAt: new Date().toISOString(), attachments: [] });
      }
    }
    const order = new Map(flow.steps.map((st, i) => [st.id, i]));
    entries.sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
    // The flagged steps, in step order; a flag on a step out of reach is void too.
    const flagged = Object.values(draft.problems)
      .filter((p) => !view.blocked.blockedStepIds.has(p.stepId))
      .sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
    const unverified = passRest ? view.remaining - pending.length : view.remaining;
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
      for (const [i, p] of flagged.entries()) {
        setCommitting(`Flagging step ${i + 1} of ${flagged.length}…`);
        await unwrap(api.POST("/flow-runs/{flowRunId}/step-problems", {
          params: { path: { flowRunId } },
          body: { stepId: p.stepId, note: p.note, workaround: p.workaround, blocking: p.blocking },
        }));
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
    if (goNext && nextFlow) {
      // Claimed only now, after this one is over — and only if nobody took it
      // meanwhile; if someone did, the dialog asks, and "leave it" goes to the board.
      setCommitting(`Taking ${nextFlow.name}…`);
      await claim(nextFlow, toFlowRun).catch(() => toBoard());
      setCommitting(null);
    } else {
      toBoard();
    }
  }

  async function abandon() {
    const n = draft.count;
    if (!confirm(`Abandon this flow?${n ? ` Your ${n} ${n === 1 ? "entry is" : "entries are"} discarded.` : ""} The next person starts it from step 1.`)) return;
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
      if (dialog || flagging || t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      const step = flow.steps[current];
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); scrollTo(Math.min(current + 1, flow.steps.length - 1)); break;
        case "k": case "ArrowUp": e.preventDefault(); scrollTo(Math.max(current - 1, 0)); break;
        case "p": if (step) { step.marks.length ? passAll(step) : scrollTo(Math.min(current + 1, flow.steps.length - 1)); } break;
        // These open a dialog that focuses a textarea at once; the key must not land in it.
        case "f": e.preventDefault(); if (step?.marks[0]) pick(step, step.marks[0], "fail"); break;
        case "m": e.preventDefault(); if (step?.marks[0]) pick(step, step.marks[0], "minor"); break;
        case "s": e.preventDefault(); if (step?.marks[0]) pick(step, step.marks[0], "skipped"); break;
        case "w": e.preventDefault(); if (step) flagStep(step); break;
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
        <RunBanner state={state} by={claimedBy} startedAt={startedAt} finishedAt={finishedAt} mine={isMine} counts={view.counts} total={view.total} flagged={view.problemByStep.size} />
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
            const problem = view.problemByStep.get(step.id);
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
                  problem={problem}
                  testTitle={testTitle}
                  onPick={(testId, v) => pick(step, testId, v)}
                  onPassAll={() => passAll(step)}
                  onFlag={() => flagStep(step)}
                  onUnflag={editable && problem ? () => draft.unflag(step.id) : undefined}
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
          Blocked from step {view.blocked.blockedFromIndex + 1}
          {view.problemByStep.get(flow.steps[view.blocked.blockedFromIndex - 1]?.id ?? "")?.blocking ? " — the step before it is wrong and there was no way past" : ""}.{" "}
          {view.blocked.unverifiedTestIds.size} tests will report as not reached.
        </p>
      ) : null}

      <div className="hand">End of flow</div>
      {editable ? (
        <div className="finishbox">
          <b>Finish to record your verdicts</b>
          <span className="meta">
            {(() => {
              const v = Object.keys(draft.draft).length;
              const f = Object.keys(draft.problems).length;
              if (!v && !f) return "Nothing recorded yet.";
              const parts = [v ? `${v} verdict${v === 1 ? "" : "s"}` : null, f ? `${f} flagged step${f === 1 ? "" : "s"}` : null].filter(Boolean);
              return `${parts.join(" and ")} on this device, not yet on the board.`;
            })()}
            {pending.length ? ` ${pending.length} test${pending.length === 1 ? " has" : "s have"} no verdict yet.` : ""}
          </span>
          <div className="finishrow">
            <button className="btn primary" disabled={!!committing} onClick={() => void finish()}>{committing ?? "Finish flow"}</button>
            {pending.length ? (
              <button className="btn soft" disabled={!!committing} onClick={() => void finish(true)} title="Records a pass for every test that has no verdict yet, then finishes">
                Pass the {pending.length === 1 ? "last test" : `${pending.length} remaining`} and finish
              </button>
            ) : null}
          </div>
          <div className="afterwards" role="radiogroup" aria-label="After finishing">
            <span className="meta">Afterwards:</span>
            <button type="button" role="radio" aria-checked={!goNext} className={`seg${goNext ? "" : " on"}`} onClick={() => chooseNext(false)}>Back to the board</button>
            <button type="button" role="radio" aria-checked={goNext} className={`seg${goNext ? " on" : ""}`} onClick={() => chooseNext(true)} disabled={!nextFlow}>
              {nextFlow ? <>Take the next flow: <span dir="auto">{nextFlow.name}</span></> : "No unclaimed flow left"}
            </button>
          </div>
        </div>
      ) : null}
      {claimDialog}

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
      <StepProblemDialog
        step={flagging}
        index={flagging ? flow.steps.findIndex((s) => s.id === flagging.id) : 0}
        onSubmit={submitFlag}
        onCancel={() => setFlagging(null)}
      />
    </main>
  );
}

function StepCard({
  step, index, device, isCurrent, done, blocked, readOnly, results, problem, testTitle, onPick, onPassAll, onFlag, onUnflag, onFocus,
}: {
  step: SnapshotStep;
  index: number;
  device: DeviceAssignment;
  isCurrent: boolean;
  done: boolean;
  blocked: boolean;
  readOnly: boolean;
  results: Map<string, TestResultRow>;
  problem: StepProblemRow | undefined;
  testTitle: (id: string) => string;
  onPick: (testId: string, v: Verdict) => void;
  onPassAll: () => void;
  onFlag: () => void;
  onUnflag: (() => void) | undefined;
  onFocus: () => void;
}) {
  const isCheck = step.kind === "assertion";
  return (
    <div
      className={`step${isCurrent ? " now" : ""}${done ? " done" : ""}${blocked ? " blocked" : ""}${problem ? " stale" : ""}`}
      id={`step-${step.id}`}
      onClick={onFocus}
      aria-current={isCurrent ? "step" : undefined}
    >
      <div className="sline">
        <span className="snum">{index + 1}</span>
        <DeviceChip device={device} />
        <KindBadge kind={step.kind} long />
        {blocked ? <span className="tag">Blocked</span> : null}
        {problem ? <span className="tag flagged"><FlagIcon />Step is wrong</span> : null}
        {!readOnly && !blocked && !problem ? (
          <button type="button" className="btn sm flagbtn" onClick={(e) => { e.stopPropagation(); onFlag(); }} title="The step, not the product, is wrong">
            <FlagIcon />Step is wrong <span className="kbd">w</span>
          </button>
        ) : null}
      </div>
      <div className="stop">
        <p className="stext" dir="auto">{step.text}</p>
      </div>
      {isCheck && step.expectedResult ? (
        <div className="expect" dir="auto"><b>Expected:</b> {step.expectedResult}</div>
      ) : null}
      <PostState text={step.postState} />
      {problem ? (
        <StepProblemNote note={problem.note} workaround={problem.workaround} blocking={problem.blocking} by={readOnly ? problem.recorded_by : undefined} onUndo={onUnflag} />
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
function RunBanner({ state, by, startedAt, finishedAt, mine, counts, total, flagged }: {
  state: string; by: string | null; startedAt: string; finishedAt: string | null; mine: boolean;
  counts: Record<Verdict, number>; total: number; flagged: number;
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
          {flagged ? ` · ${flagged} step${flagged === 1 ? "" : "s"} flagged as wrong` : ""}
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
    ["w", "flag — the step is wrong"],
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
