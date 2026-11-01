/**
 * Every testing day for a product, open ones first, then the closed ones with
 * their final counts.
 *
 * Only days opened this week stream live. Every other card reads the tally the
 * runs list already carries: a closed day never changes, and two live shapes per
 * card across a few hundred days starves every other request to this origin.
 */
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type RunSummary } from "../lib/api.ts";
import { isStale, useRunBoard } from "../lib/run-model.ts";
import { Bar, type Counts } from "../components/Progress.tsx";
import { useTitle } from "../lib/title.ts";

export function Runs() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => unwrap(api.GET("/products/{product}", { params: { path: { product: productId } } })) });
  const runs = useQuery({ queryKey: ["runs", productId], queryFn: () => unwrap(api.GET("/products/{productId}/runs", { params: { path: { productId } } })) });
  useTitle(product.data ? `Runs · ${product.data.name} — Flowdeck` : "Flowdeck");

  const all = runs.data ?? [];
  const open = all.filter((r) => !r.closedAt);
  const closed = all.filter((r) => r.closedAt).sort((a, b) => b.date.localeCompare(a.date));
  const stale = open.filter(isStale);
  const qc = useQueryClient();
  const [closing, setClosing] = useState(false);

  async function closeStale() {
    if (!confirm(`Close ${stale.length === 1 ? "the testing day" : `all ${stale.length} testing days`} opened more than a week ago? Their reports become final. Any of them can be reopened.`)) return;
    setClosing(true);
    try {
      for (const r of stale) await unwrap(api.POST("/runs/{runId}/close", { params: { path: { runId: r.id }, query: { reopen: "false" } } }));
    } finally {
      setClosing(false);
      await qc.invalidateQueries({ queryKey: ["runs", productId] });
    }
  }

  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1>Runs</h1>
          <p className="sub">Every testing day, live while it is open and final once it is closed. A day runs against a snapshot of its template.</p>
        </div>
        <Link className="btn primary" to="/products/$productId/templates" params={{ productId }}>Start a testing day</Link>
      </div>

      <section className="section" style={{ marginBottom: 28 }}>
        <div className="head">
          <h2>Open</h2>
          {stale.length ? (
            <button className="btn sm" disabled={closing} onClick={() => void closeStale()}>
              {closing ? "Closing…" : `Close ${stale.length} older than a week`}
            </button>
          ) : open.length ? <span className="meta">{open.length}</span> : null}
        </div>
        {open.length ? (
          <div className="grid gap-3">{open.map((r) => <RunCard key={r.id} productId={productId} run={r} />)}</div>
        ) : runs.data ? (
          <div className="empty"><b>No testing day is open</b><span>Start one from a template; each tester then claims a flow.</span></div>
        ) : null}
      </section>

      <section className="section">
        <div className="head"><h2>Closed</h2>{closed.length ? <span className="meta">{closed.length}</span> : null}</div>
        {closed.length ? (
          <div className="grid gap-3">{closed.map((r) => <RunCard key={r.id} productId={productId} run={r} />)}</div>
        ) : runs.data ? (
          <p className="meta" style={{ margin: 0 }}>Nothing has been closed yet.</p>
        ) : null}
      </section>
    </main>
  );
}

function RunCard({ productId, run }: { productId: string; run: RunSummary }) {
  return !run.closedAt && !isStale(run)
    ? <LiveRunCard productId={productId} run={run} />
    : <RunCardBody productId={productId} run={run} counts={run.counts} total={run.total} notReached={run.notReached} flows={null} />;
}

/** An open day from this week: its numbers move as flows are finished. */
function LiveRunCard({ productId, run }: { productId: string; run: RunSummary }) {
  const board = useRunBoard(run.id);
  return board
    ? <RunCardBody productId={productId} run={run} counts={board.counts} total={board.total} notReached={board.notReached} flows={board.flows.length} />
    : <RunCardBody productId={productId} run={run} counts={run.counts} total={run.total} notReached={run.notReached} flows={null} />;
}

function RunCardBody({ productId, run, counts, total, notReached, flows }: {
  productId: string; run: RunSummary; counts: Counts; total: number; notReached: number; flows: number | null;
}) {
  const date = new Date(run.date);
  const stale = !run.closedAt && isStale(run);
  return (
    <Link className={`panel pad runrow${run.closedAt ? "" : " daycard"}`} to="/products/$productId/runs/$runId" params={{ productId, runId: run.id }}>
      <div style={{ minWidth: 0 }}>
        <h3 dir="auto" style={{ margin: 0 }}>{date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} <span className="meta" style={{ fontWeight: 400 }}>· {run.templateName}</span></h3>
        <span className="meta">
          Started by {run.startedBy} at {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {flows !== null ? ` · ${flows} flows` : ""}
        </span>
      </div>
      <span className={`pill ${run.closedAt ? "skip" : stale ? "minor" : "open"}`}><span className="dot" />{run.closedAt ? "Closed" : stale ? "Still open" : "In progress"}</span>
      <Bar counts={counts} total={total} />
      <div className="runcounts">
        <span><b>{counts.pass}</b> passed</span>
        <span><b style={{ color: counts.fail ? "var(--color-fail)" : undefined }}>{counts.fail}</b> failed</span>
        <span><b>{counts.minor}</b> minor</span>
        <span><b>{counts.skipped}</b> skipped</span>
        <span><b>{notReached}</b> not reached</span>
        <span className="meta" style={{ marginLeft: "auto" }}>{total - notReached} of {total} tests reached</span>
      </div>
    </Link>
  );
}
