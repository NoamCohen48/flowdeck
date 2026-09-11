/**
 * Every testing day for a product, open ones first with live progress, then the
 * closed ones with their final counts (04 §Run reporting).
 */
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api.ts";
import { useRunBoard } from "../lib/run-model.ts";
import { Bar } from "../components/Progress.tsx";
import { useTitle } from "../lib/title.ts";

export function Runs() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => unwrap(api.GET("/products/{productId}", { params: { path: { productId } } })) });
  const runs = useQuery({ queryKey: ["runs", productId], queryFn: () => unwrap(api.GET("/products/{productId}/runs", { params: { path: { productId } } })) });
  useTitle(product.data ? `Runs · ${product.data.name} — Flowdeck` : "Flowdeck");

  const all = runs.data ?? [];
  const open = all.filter((r) => !r.closedAt);
  const closed = all.filter((r) => r.closedAt).sort((a, b) => b.date.localeCompare(a.date));

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
        <div className="head"><h2>Open</h2>{open.length ? <span className="meta">{open.length}</span> : null}</div>
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

function RunCard({ productId, run }: { productId: string; run: { id: string; templateName: string; startedBy: string; date: string; closedAt: string | null } }) {
  const board = useRunBoard(run.id);
  const date = new Date(run.date);
  const done = board ? board.total - board.notReached : 0;
  return (
    <Link className={`panel pad runrow${run.closedAt ? "" : " daycard"}`} to="/products/$productId/runs/$runId" params={{ productId, runId: run.id }}>
      <div style={{ minWidth: 0 }}>
        <h3 dir="auto" style={{ margin: 0 }}>{date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} <span className="meta" style={{ fontWeight: 400 }}>· {run.templateName}</span></h3>
        <span className="meta">
          Started by {run.startedBy} at {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {board ? ` · ${board.flows.length} flows` : ""}
        </span>
      </div>
      <span className={`pill ${run.closedAt ? "skip" : "open"}`}><span className="dot" />{run.closedAt ? "Closed" : "In progress"}</span>
      {board ? (
        <>
          <Bar counts={board.counts} total={board.total} />
          <div className="runcounts">
            <span><b>{board.counts.pass}</b> passed</span>
            <span><b style={{ color: board.counts.fail ? "var(--color-fail)" : undefined }}>{board.counts.fail}</b> failed</span>
            <span><b>{board.counts.minor}</b> minor</span>
            <span><b>{board.counts.skipped}</b> skipped</span>
            <span><b>{board.notReached}</b> not reached</span>
            <span className="meta" style={{ marginLeft: "auto" }}>{done} of {board.total} tests reached</span>
          </div>
        </>
      ) : null}
    </Link>
  );
}
