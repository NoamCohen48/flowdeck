/**
 * The testing-day board. Every flow with its precondition, devices, estimate,
 * state and who holds it — live. Claims are advisory (D26): a flow someone else
 * holds can still be taken, after a confirmation that says who and how far.
 *
 * Recorded results arrive when a flow is finished. Until then each running flow
 * shows its tester's provisional progress (D42): the step they are on, a tally,
 * and anything that went wrong, with the note — never counted in the day's numbers.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { computeHandoffs, deviceSlots, type DeviceSlots, type LiveProgress } from "@flowdeck/domain";
import { api, unwrap } from "../lib/api.ts";
import { useLiveResults, useLiveStepProblems, useRunBoard, type FlowProgress } from "../lib/run-model.ts";
import { worstResultByTest, type Verdict } from "@flowdeck/domain";
import { useMe } from "../lib/identity.tsx";
import { usePeers, usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { DeviceChip } from "../components/Device.tsx";
import { Bar, Kpis, Tally } from "../components/Progress.tsx";
import { IssueCard, StepProblemCard, useIssues } from "../components/Issues.tsx";
import { useClaim } from "../components/ClaimDialog.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FlowRunRow } from "../lib/collections.ts";
import type { SnapshotFlow } from "../lib/api.ts";

export function Day() {
  const { productId, runId } = useParams({ strict: false }) as { productId: string; runId: string };
  const board = useRunBoard(runId);
  usePresence(`run:${runId}`);
  const here = usePeers(`run:${runId}`);
  const qc = useQueryClient();
  useTitle(board ? `Testing day · ${board.run.snapshot.name} — Flowdeck` : "Flowdeck");
  const { rows: stepProblems } = useLiveStepProblems(runId);
  const resultCount = (board ? board.flows.reduce((n, f) => n + Object.values(f.counts).reduce((a, b) => a + b, 0), 0) : 0) + stepProblems.length;
  const issues = useIssues(runId, resultCount);
  const slots = useMemo(() => (board ? deviceSlots(board.run.snapshot.flows) : new Map()), [board?.run.snapshot.flows]);

  async function close(reopen: boolean) {
    if (!reopen && !confirm("Close the day? It leaves the open list and its report is final. You can reopen it.")) return;
    await unwrap(api.POST("/runs/{runId}/close", { params: { path: { runId }, query: { reopen: reopen ? "true" : "false" } } }));
    await qc.invalidateQueries({ queryKey: ["run", runId] });
    await qc.invalidateQueries({ queryKey: ["runs", productId] });
  }

  if (!board) return <main className="shell"><p className="meta">Loading the testing day…</p></main>;
  const { run, flows, counts, total, notReached } = board;
  const titles = new Map(run.snapshot.tests.map((t) => [t.id, t.title]));
  const testTitle = (id: string) => titles.get(id) ?? "(archived test)";
  const date = new Date(run.date);

  return (
    <main className="shell">
      <p className="crumb">
        <Link to="/products/$productId" params={{ productId }} className="lnk">{run.snapshot.name}</Link>
      </p>
      <div className="row-split">
        <div>
          <h1>Testing day · {date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</h1>
          <p className="sub">
            Pick a flow and it is yours until it is finished. If you abandon it, the next person starts it from step 1.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {here.map((a) => <span key={a} className="tag" dir="auto">{a}</span>)}
          <span className={`pill ${run.closedAt ? "skip" : "open"}`}><span className="dot" />{run.closedAt ? "Closed" : "In progress"}</span>
          {run.closedAt
            ? <button className="btn sm" onClick={() => void close(true)}>Reopen</button>
            : <button className="btn sm" onClick={() => void close(false)}>Close the day</button>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <Kpis counts={counts} notReached={notReached} />
        <div style={{ padding: "0 18px 16px" }}><Bar counts={counts} total={total} /></div>
      </div>

      <InFlight flows={flows.map((f) => ({ flow: f.flow, flowRuns: f.flowRuns }))} />

      <h2>Flows</h2>
      <div className="stack">
        {flows.map((f) => <FlowCard key={f.flow.id} productId={productId} runId={runId} progress={f} slots={slots} testTitle={testTitle} />)}
      </div>
      <h2>Report</h2>
      {issues.data && issues.data.issues.length ? (
        <div className="stack">
          {issues.data.issues.map((i, n) => <IssueCard key={n} feed={issues.data!} issue={i} productId={productId} runId={runId} />)}
        </div>
      ) : (
        <p className="meta">{issues.data ? "Nothing recorded has gone wrong so far." : "Loading the report…"}</p>
      )}
      {notReached ? <p className="meta" style={{ marginTop: 12 }}>{notReached} test{notReached === 1 ? "" : "s"} not reached yet — in scope, with no result at all.</p> : null}

      {issues.data?.stepProblems.length ? (
        <>
          <h2>Steps to update</h2>
          <p className="meta" style={{ margin: "-6px 0 12px" }}>
            Flagged by testers as wrong — the flow, not the product. Fix them in the template before the next day.
          </p>
          <div className="stack">
            {issues.data.stepProblems.map((p, n) => <StepProblemCard key={n} feed={issues.data!} problem={p} productId={productId} templateId={run.templateId} />)}
          </div>
        </>
      ) : null}

      <p className="meta" style={{ marginTop: 24 }}>
        This day runs against a snapshot of the template taken at{" "}
        {new Date(run.snapshot.takenAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. Edits made now apply the next time it is run.
      </p>
    </main>
  );
}

function FlowCard({ productId, runId, progress, slots, testTitle }: { productId: string; runId: string; progress: FlowProgress; slots: DeviceSlots; testTitle: (id: string) => string }) {
  const { flow, flowRuns, testCount, state, holders } = progress;
  const me = useMe();
  const navigate = useNavigate();
  const devices = computeHandoffs(flow.steps, slots).devices;
  const mine = flowRuns.find((fr) => fr.state === "claimed" && fr.claimed_by === me.name);
  const label = { done: "Finished", running: "In progress", open: "Unclaimed" }[state];
  const { claim, busy, dialog } = useClaim(runId);
  const open = (flowRunId: string) =>
    void navigate({ to: "/products/$productId/runs/$runId/flows/$flowRunId", params: { productId, runId, flowRunId } });

  const finished = flowRuns.filter((fr) => fr.state === "finished").sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  const running = flowRuns.filter((fr) => fr.state === "claimed");
  const cta = mine ? (
    <Link className="btn primary" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId: mine.id }}>Continue</Link>
  ) : (
    <button className={`btn${state === "done" ? "" : " primary"}`} disabled={busy} onClick={() => void claim(flow, open)}>
      {state === "open" ? "Claim flow" : state === "done" ? "Run it again" : "Run it too"}
    </button>
  );

  return (
    <div className={`panel pad flowcard ${state}`} id={`flow-${flow.id}`}>
      <div className="row-split">
        <div style={{ flex: 1, minWidth: 230 }}>
          <div className="flex gap-2 items-center flex-wrap">
            <h3 dir="auto" style={{ margin: 0 }}>{flow.name}</h3>
            <span className={`pill ${state === "done" ? "pass" : state === "running" ? "open" : "skip"}`}><span className="dot" />{label}</span>
          </div>
          <p className="meta" style={{ margin: "4px 0 0" }}>
            {flow.steps.length} steps · marks {testCount} tests{flow.estimatedMinutes ? ` · ~${flow.estimatedMinutes} min` : ""}
            {holders.length ? ` · claimed by ${holders.join(", ")}` : !finished.length ? " · nobody has taken this yet" : ""}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">{devices.map((d) => <DeviceChip key={d.label} device={d} ghost />)}</div>
        {cta}
      </div>
      {flow.precondition ? <div className="pre" style={{ fontSize: 13.5 }} dir="auto"><b>Before you start:</b> {flow.precondition}</div> : null}
      {running.length || finished.length ? (
        <div className="results">
          {running.map((fr) => <LiveRow key={fr.id} productId={productId} runId={runId} flow={flow} flowRun={fr} testTitle={testTitle} />)}
          {finished.map((fr) => <ResultRow key={fr.id} productId={productId} runId={runId} flowRunId={fr.id} by={fr.claimed_by ?? "someone"} at={fr.finished_at} testCount={testCount} />)}
        </div>
      ) : null}
      {dialog}
    </div>
  );
}

/** One finished run of a flow: who, when, and the verdicts they recorded. */
function ResultRow({ productId, runId, flowRunId, by, at, testCount }: { productId: string; runId: string; flowRunId: string; by: string; at: string | null; testCount: number }) {
  const { rows } = useLiveResults(runId);
  const { rows: problems } = useLiveStepProblems(runId);
  const flagged = problems.filter((p) => p.flow_run_id === flowRunId).length;
  const mine = rows.filter((r) => r.flow_run_id === flowRunId);
  const worst = worstResultByTest(mine.map((r) => ({ testId: r.test_id, verdict: r.verdict })));
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, minor: 0, skipped: 0 };
  for (const v of worst.values()) counts[v] += 1;
  const when = at ? new Date(at) : null;
  return (
    <Link className="resultrow" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId }}>
      <span className="avatar" aria-hidden>{by.trim().charAt(0).toUpperCase()}</span>
      <span className="who">
        <b dir="auto">{by}</b>
        <span className="meta">
          {when ? `Finished ${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "Finished"} · {worst.size} of {testCount} tests reached
          {flagged ? ` · ${flagged} step${flagged === 1 ? "" : "s"} flagged as wrong` : ""}
        </span>
      </span>
      <Tally counts={counts} />
      <Bar counts={counts} total={testCount} />
      <span className="go">View results</span>
    </Link>
  );
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

const KIND_LABEL: Record<LiveProgress["issues"][number]["kind"], string> = {
  fail: "Failed", minor: "Minor", skipped: "Skipped — the test is wrong", flag: "Step is wrong",
};

/**
 * A flow someone is running right now: where they are and what has gone wrong so
 * far, from their device's draft (D42). Provisional — dashed, and not in the totals.
 */
function LiveRow({ productId, runId, flow, flowRun, testTitle }: { productId: string; runId: string; flow: SnapshotFlow; flowRun: FlowRunRow; testTitle: (id: string) => string }) {
  const by = flowRun.claimed_by ?? "someone";
  const p = flowRun.progress;
  return (
    <div className="liverow">
      <Link className="resultrow live" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId: flowRun.id }}>
        <span className="avatar" aria-hidden>{by.trim().charAt(0).toUpperCase()}</span>
        <span className="who">
          <b dir="auto">{by} <span className="livedot" aria-hidden />running now</b>
          <span className="meta">
            {p
              ? <>On step {p.step + 1} of {flow.steps.length} · {p.counts.pass + p.counts.fail + p.counts.minor + p.counts.skipped} of {p.total} tests checked{p.blockedFrom !== null ? ` · blocked from step ${p.blockedFrom + 1}` : ""} · {ago(p.updatedAt)}</>
              : "Has not recorded anything yet"}
          </span>
        </span>
        {p ? <Tally counts={p.counts} /> : <span />}
        {p ? <Bar counts={p.counts} total={p.total} /> : <span />}
        <span className="go">Watch</span>
      </Link>
      {p?.issues.length ? (
        <ul className="liveissues">
          {p.issues.map((i, n) => (
            <li key={n} className={`k-${i.kind}`}>
              <span className="what">{KIND_LABEL[i.kind]}{i.blocking ? " · blocked the rest" : ""}</span>
              <span className="where">Step {i.step + 1}{i.testId ? ` · ${testTitle(i.testId)}` : ""}</span>
              {i.note ? <span className="why" dir="auto">{i.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}


/**
 * The coordinator's alarm: anything that has gone wrong in a flow still running,
 * at the top of the board, before it is recorded. Blocking problems first.
 */
function InFlight({ flows }: { flows: { flow: SnapshotFlow; flowRuns: FlowRunRow[] }[] }) {
  const hits = flows.flatMap(({ flow, flowRuns }) =>
    flowRuns
      .filter((fr) => fr.state === "claimed" && fr.progress)
      .map((fr) => {
        const issues = fr.progress!.issues.filter((i) => i.kind === "fail" || i.kind === "flag");
        return { flow, by: fr.claimed_by ?? "someone", issues, blocking: issues.some((i) => i.blocking) };
      })
      .filter((h) => h.issues.length),
  ).sort((a, b) => Number(b.blocking) - Number(a.blocking));
  if (!hits.length) return null;
  return (
    <div className="inflight" role="status">
      <b>Going wrong right now</b>
      <span className="meta">From flows still being run — not in the numbers above until they are finished.</span>
      <ul>
        {hits.map((h, n) => {
          const fails = h.issues.filter((i) => i.kind === "fail").length;
          const flags = h.issues.length - fails;
          return (
            <li key={n} className={h.blocking ? "blocking" : ""}>
              <a href={`#flow-${h.flow.id}`} dir="auto">{h.flow.name}</a>
              <span>
                {h.by}: {[fails ? `${fails} failure${fails === 1 ? "" : "s"}` : null, flags ? `${flags} wrong step${flags === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}
                {h.blocking ? " — stuck, the rest of the flow is blocked" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
