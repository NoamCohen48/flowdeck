/**
 * The testing-day board. Every flow with its precondition, devices, estimate,
 * state and who holds it — live. Claims are advisory (D26): a flow someone else
 * holds can still be taken, after a confirmation that says who and how far.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { computeHandoffs } from "@flowdeck/domain";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { presenceOf } from "../lib/collections.ts";
import { useRunBoard, type FlowProgress } from "../lib/run-model.ts";
import { useMe } from "../lib/identity.tsx";
import { usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { DeviceChip } from "../components/Device.tsx";
import { Bar, Kpis } from "../components/Progress.tsx";

export function Day() {
  const { productId, runId } = useParams({ strict: false }) as { productId: string; runId: string };
  const board = useRunBoard(runId);
  usePresence(`run:${runId}`);
  const presence = presenceOf(`run:${runId}`);
  const here = useLiveQuery(() => presence, [presence]);
  useTitle(board ? `Testing day · ${board.run.snapshot.name} — Flowdeck` : "Flowdeck");

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
          {(here.data ?? []).map((p) => <span key={p.actor} className="tag" dir="auto">{p.actor}</span>)}
          <span className={`pill ${run.closedAt ? "skip" : "open"}`}><span className="dot" />{run.closedAt ? "Closed" : "In progress"}</span>
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
      <p className="meta" style={{ marginTop: 24 }}>
        This day runs against a snapshot of the template taken at{" "}
        {new Date(run.snapshot.takenAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. Edits made now apply the next time it is run.
      </p>
    </main>
  );
}

function FlowCard({ productId, runId, progress }: { productId: string; runId: string; progress: FlowProgress }) {
  const { flow, flowRuns, testCount, reached, counts, state, holders } = progress;
  const me = useMe();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<{ holders: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const devices = computeHandoffs(flow.steps).devices;
  const mine = flowRuns.find((fr) => fr.state === "claimed" && fr.claimed_by === me.name);
  const label = { done: "Finished", running: "In progress", open: "Unclaimed" }[state];

  async function claim(confirm = false) {
    setBusy(true);
    try {
      const res = await unwrap(
        api.POST("/runs/{runId}/flows/{flowId}/claim", {
          params: { path: { runId, flowId: flow.id }, query: { confirm: confirm ? "true" : "false" } },
        }),
      );
      void navigate({ to: "/products/$productId/runs/$runId/flows/$flowRunId", params: { productId, runId, flowRunId: res.flowRun.id } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { alsoRunning: { claimedBy: string | null }[] };
        setConfirming({ holders: body.alsoRunning.map((f) => f.claimedBy ?? "someone") });
      } else throw e;
    } finally {
      setBusy(false);
    }
  }

  const finished = flowRuns.filter((fr) => fr.state === "finished");
  const cta = mine ? (
    <Link className="btn primary" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId: mine.id }}>Continue</Link>
  ) : (
    <button className="btn primary" disabled={busy} onClick={() => void claim()}>
      {state === "open" ? "Claim flow" : "Run it too"}
    </button>
  );

  return (
    <div className="panel pad">
      <div className="row-split">
        <div style={{ flex: 1, minWidth: 230 }}>
          <h3 dir="auto">{flow.name}</h3>
          <p className="meta" style={{ margin: "2px 0 6px" }}>
            {flow.steps.length} steps · marks {testCount} tests{flow.estimatedMinutes ? ` · ~${flow.estimatedMinutes} min` : ""}
          </p>
          <span className="meta">
            {holders.length ? `Claimed by ${holders.join(", ")}` : finished.length ? `Run by ${[...new Set(finished.map((f) => f.claimed_by))].join(", ")}` : "Nobody has taken this yet"}
          </span>
        </div>
        <div className="flex gap-1.5 flex-wrap">{devices.map((d) => <DeviceChip key={d.label} device={d} ghost />)}</div>
        {cta}
      </div>
      <div className="row-split" style={{ marginTop: 12 }}>
        <div style={{ flex: 1 }}><Bar counts={counts} total={testCount} /></div>
        <span className="tag">{label}{reached ? ` · ${reached}/${testCount}` : ""}</span>
      </div>
      {flow.precondition ? <div className="pre" style={{ fontSize: 13.5 }} dir="auto"><b>Before you start:</b> {flow.precondition}</div> : null}
      {finished.map((fr) => (
        <p key={fr.id} className="meta" style={{ margin: "8px 0 0" }}>
          <Link className="lnk" to="/products/$productId/runs/$runId/flows/$flowRunId" params={{ productId, runId, flowRunId: fr.id }}>
            View {fr.claimed_by}'s results
          </Link>
        </p>
      ))}
      {confirming ? (
        <div className="note skp" style={{ marginLeft: 0 }}>
          <b>{confirming.holders.join(" and ")} {confirming.holders.length > 1 ? "are" : "is"} already on this flow.</b> You can run it too — both sets of results are kept, and if either of you hits a bug the day reports it.
          <div className="flex gap-2 mt-2">
            <button className="btn sm primary" disabled={busy} onClick={() => void claim(true)}>Run it anyway</button>
            <button className="btn sm" onClick={() => setConfirming(null)}>Never mind</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
