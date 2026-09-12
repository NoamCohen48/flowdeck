/**
 * The testing-day board. Every flow with its precondition, devices, estimate,
 * state and who holds it — live. Claims are advisory (D26): a flow someone else
 * holds can still be taken, after a confirmation that says who and how far.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { computeHandoffs } from "@flowdeck/domain";
import { api, unwrap } from "../lib/api.ts";
import { useLiveResults, useRunBoard, type FlowProgress } from "../lib/run-model.ts";
import { worstResultByTest, type Verdict } from "@flowdeck/domain";
import { useMe } from "../lib/identity.tsx";
import { usePeers, usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { DeviceChip } from "../components/Device.tsx";
import { Bar, Kpis } from "../components/Progress.tsx";
import { IssueCard, useIssues } from "../components/Issues.tsx";
import { useClaim } from "../components/ClaimDialog.tsx";
import { useQueryClient } from "@tanstack/react-query";

export function Day() {
  const { productId, runId } = useParams({ strict: false }) as { productId: string; runId: string };
  const board = useRunBoard(runId);
  usePresence(`run:${runId}`);
  const here = usePeers(`run:${runId}`);
  const qc = useQueryClient();
  useTitle(board ? `Testing day · ${board.run.snapshot.name} — Flowdeck` : "Flowdeck");
  const resultCount = board ? board.flows.reduce((n, f) => n + Object.values(f.counts).reduce((a, b) => a + b, 0), 0) : 0;
  const issues = useIssues(runId, resultCount);

  async function close(reopen: boolean) {
    if (!reopen && !confirm("Close the day? It leaves the open list and its report is final. You can reopen it.")) return;
    await unwrap(api.POST("/runs/{runId}/close", { params: { path: { runId }, query: { reopen: reopen ? "true" : "false" } } }));
    await qc.invalidateQueries({ queryKey: ["run", runId] });
    await qc.invalidateQueries({ queryKey: ["runs", productId] });
  }

  if (!board) return <main className="shell"><p className="meta">Loading the testing day…</p></main>;
  const { run, flows, counts, total, notReached } = board;
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

      <h2>Flows</h2>
      <div className="stack">
        {flows.map((f) => <FlowCard key={f.flow.id} productId={productId} runId={runId} progress={f} />)}
      </div>
      <h2>Report</h2>
      {issues.data && issues.data.issues.length ? (
        <div className="stack">
          {issues.data.issues.map((i, n) => <IssueCard key={n} feed={issues.data!} issue={i} productId={productId} runId={runId} />)}
        </div>
      ) : (
        <p className="meta">{issues.data ? "Nothing has gone wrong so far." : "…"}</p>
      )}
      {notReached ? <p className="meta" style={{ marginTop: 12 }}>{notReached} test{notReached === 1 ? "" : "s"} not reached yet — in scope, with no result at all.</p> : null}

      <p className="meta" style={{ marginTop: 24 }}>
        This day runs against a snapshot of the template taken at{" "}
        {new Date(run.snapshot.takenAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. Edits made now apply the next time it is run.
      </p>
    </main>
  );
}

function FlowCard({ productId, runId, progress }: { productId: string; runId: string; progress: FlowProgress }) {
  const { flow, flowRuns, testCount, state, holders } = progress;
  const me = useMe();
  const navigate = useNavigate();
  const devices = computeHandoffs(flow.steps).devices;
  const mine = flowRuns.find((fr) => fr.state === "claimed" && fr.claimed_by === me.name);
  const label = { done: "Finished", running: "In progress", open: "Unclaimed" }[state];
  const { claim, busy, dialog } = useClaim(runId);
  const open = (flowRunId: string) =>
    void navigate({ to: "/products/$productId/runs/$runId/flows/$flowRunId", params: { productId, runId, flowRunId } });

  const finished = flowRuns.filter((fr) => fr.state === "finished").sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  const cta = mine ? (
    <Link className="btn primary" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId: mine.id }}>Continue</Link>
  ) : (
    <button className={`btn${state === "done" ? "" : " primary"}`} disabled={busy} onClick={() => void claim(flow, open)}>
      {state === "open" ? "Claim flow" : state === "done" ? "Run it again" : "Run it too"}
    </button>
  );

  return (
    <div className={`panel pad flowcard ${state}`}>
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
      {finished.length ? (
        <div className="results">
          {finished.map((fr) => <ResultRow key={fr.id} productId={productId} runId={runId} flowRunId={fr.id} by={fr.claimed_by ?? "someone"} at={fr.finished_at} testCount={testCount} />)}
        </div>
      ) : state === "running" ? (
        <p className="meta" style={{ margin: "10px 0 0", fontSize: 13 }}>Results appear here when the flow is finished.</p>
      ) : null}
      {dialog}
    </div>
  );
}

/** One finished run of a flow: who, when, and the verdicts they recorded. */
function ResultRow({ productId, runId, flowRunId, by, at, testCount }: { productId: string; runId: string; flowRunId: string; by: string; at: string | null; testCount: number }) {
  const { rows } = useLiveResults(runId);
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
        </span>
      </span>
      <span className="tally">
        <span className="pill pass"><span className="dot" />{counts.pass}</span>
        <span className={`pill fail${counts.fail ? "" : " off"}`}><span className="dot" />{counts.fail}</span>
        <span className={`pill minor${counts.minor ? "" : " off"}`}><span className="dot" />{counts.minor}</span>
        <span className={`pill skip${counts.skipped ? "" : " off"}`}><span className="dot" />{counts.skipped}</span>
      </span>
      <Bar counts={counts} total={testCount} />
      <span className="go">View results</span>
    </Link>
  );
}
