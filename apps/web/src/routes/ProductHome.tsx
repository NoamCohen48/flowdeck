/** Product overview, milestone-3 cut: templates to start a day from, and recent days. */
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRunBoard } from "../lib/run-model.ts";
import { useTestIndex } from "../lib/editor-model.ts";
import { Bar } from "../components/Progress.tsx";
import { IssueCard, type IssueFeed } from "../components/Issues.tsx";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { useTitle } from "../lib/title.ts";

export function ProductHome() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => unwrap(api.GET("/products/{productId}", { params: { path: { productId } } })) });
  const templates = useQuery({ queryKey: ["templates", productId], queryFn: () => unwrap(api.GET("/products/{productId}/templates", { params: { path: { productId } } })) });
  const runs = useQuery({ queryKey: ["runs", productId], queryFn: () => unwrap(api.GET("/products/{productId}/runs", { params: { path: { productId } } })) });
  const coverage = useQuery({ queryKey: ["coverage", productId], queryFn: () => unwrap(api.GET("/products/{productId}/coverage", { params: { path: { productId } } })) });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [warn, setWarn] = useState<{ templateId: string; openRunId: string } | null>(null);
  const [creating, setCreating] = useState(false);
  useTitle(product.data ? `${product.data.name} — Flowdeck` : "Flowdeck");

  async function start(templateId: string, force = false) {
    try {
      const run = await unwrap(api.POST("/templates/{templateId}/runs", { params: { path: { templateId }, query: { force: force ? "true" : "false" } } }));
      await qc.invalidateQueries({ queryKey: ["runs", productId] });
      void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId: run.id } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setWarn({ templateId, openRunId: (e.body as { openRunId: string }).openRunId });
      else throw e;
    }
  }

  async function createTemplate(name: string, description: string) {
    const [tpl] = await unwrap(api.POST("/products/{productId}/templates", { params: { path: { productId } }, body: { templates: [{ name, description, status: "active", flows: [] }] } }));
    await qc.invalidateQueries({ queryKey: ["templates", productId] });
    if (tpl) void navigate({ to: "/products/$productId/templates/$templateId", params: { productId, templateId: tpl.id } });
  }

  const open = (runs.data ?? []).filter((r) => !r.closedAt);
  const feeds = useQueries({
    queries: open.map((r) => ({
      queryKey: ["issues", r.id, "home"],
      queryFn: () => unwrap(api.GET("/runs/{runId}/issues", { params: { path: { runId: r.id } } })),
      refetchInterval: 15_000,
    })),
  });
  const { byId } = useTestIndex(productId);

  if (!product.data) return <main className="shell"><p className="meta">Loading…</p></main>;
  const uncovered = (coverage.data?.tests ?? []).filter((t) => t.needsAttention);
  const todaysIssues = feeds.flatMap((q) => (q.data ? q.data.issues.filter((i) => i.type !== "minor").map((i) => ({ feed: q.data as IssueFeed, issue: i })) : []));

  return (
    <main className="shell">
      <h1 dir="auto">{product.data.name}</h1>
      <p className="sub" dir="auto">{product.data.description}</p>

      {coverage.data ? (
        <div className="panel">
          <div className="kpi">
            <div><b>{coverage.data.total}</b><span>tests in the library</span></div>
            <div><b>{coverage.data.covered}</b><span>covered by a template</span></div>
            <div><b style={{ color: coverage.data.uncovered ? "var(--color-fail)" : undefined }}>{coverage.data.uncovered}</b><span>covered by nothing</span></div>
            <div><b>{templates.data?.length ?? 0}</b><span>templates</span></div>
          </div>
        </div>
      ) : null}

      <h2>Today's testing day</h2>
      {open.length ? (
        <div className="stack">
          {open.map((r) => <OpenRun key={r.id} productId={productId} runId={r.id} templateName={r.templateName} startedBy={r.startedBy} date={r.date} />)}
        </div>
      ) : (
        <p className="meta">No testing day is open. Start one from a template below.</p>
      )}

      <div className="row-split" style={{ marginTop: 34 }}>
        <h2 style={{ margin: 0 }}>Templates</h2>
        <button className="btn sm" onClick={() => setCreating(true)}>＋ New template</button>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {creating ? <NewTemplate onSave={createTemplate} onCancel={() => setCreating(false)} /> : null}
        {(templates.data ?? []).map((t) => (
          <div key={t.id} className="panel pad">
            <div className="row-split">
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3><Link className="lnk" to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }} dir="auto">{t.name}</Link> {t.status === "archived" ? <span className="tag">archived</span> : null}</h3>
                <p className="meta" style={{ margin: "2px 0 0" }} dir="auto">{t.description}</p>
                <p className="meta" style={{ margin: "4px 0 0" }}>{t.flowCount} flows · marks {t.marksTestCount} tests</p>
              </div>
              {t.status === "active" ? <button className="btn primary" onClick={() => void start(t.id)}>Start a testing day</button> : null}
            </div>
            {warn?.templateId === t.id ? (
              <div className="note skp" style={{ marginLeft: 0 }}>
                A testing day is already open for this template.
                <div className="flex gap-2 mt-2">
                  <Link className="btn sm primary" to="/products/$productId/runs/$runId" params={{ productId, runId: warn.openRunId }}>Open it</Link>
                  <button className="btn sm" onClick={() => void start(t.id, true)}>Start another anyway</button>
                  <button className="btn sm" onClick={() => setWarn(null)}>Never mind</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {uncovered.length || todaysIssues.length ? (
        <>
          <h2>Needs attention</h2>
          <div className="stack">
            {uncovered.map((t) => (
              <div key={t.testId} className="panel pad row-split" style={{ boxShadow: "inset 3px 0 0 var(--color-fail)" }}>
                <div>
                  <b dir="auto">{byId.get(t.testId)?.current.title ?? "…"}</b>
                  <p className="meta" style={{ margin: "2px 0 0" }}>In no template at all. It will never be checked on a testing day.</p>
                </div>
                <Link className="btn sm" to="/products/$productId/tests" params={{ productId }} search={{ test: t.testId }}>Review</Link>
              </div>
            ))}
            {todaysIssues.map(({ feed, issue }, n) => <IssueCard key={n} feed={feed} issue={issue} productId={productId} />)}
          </div>
        </>
      ) : null}

      {(runs.data ?? []).some((r) => r.closedAt) ? (
        <>
          <h2>Past testing days</h2>
          <div className="stack">
            {(runs.data ?? []).filter((r) => r.closedAt).map((r) => (
              <Link key={r.id} className="panel pad row-split lnk" to="/products/$productId/runs/$runId" params={{ productId, runId: r.id }}>
                <span dir="auto">{r.templateName}</span><span className="meta">{new Date(r.date).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}

function NewTemplate({ onSave, onCancel }: { onSave: (name: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="panel pad">
      <label className="f" htmlFor="tpl-name" style={{ marginTop: 0 }}>Template name</label>
      <input id="tpl-name" type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="Monthly regression — fresh install" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <label className="f" htmlFor="tpl-desc">What setup does it target?</label>
      <textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" placeholder="Fresh install on a phone and a tablet, signed into the QA workspace. The setup is the whole reason several templates exist." style={{ minHeight: 56 }} />
      <div className="flex gap-2 mt-3">
        <button className="btn primary" disabled={!name.trim()} onClick={() => void onSave(name.trim(), description.trim())}>Create</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** An open day's card, with its progress live off the same collections the board uses. */
function OpenRun({ productId, runId, templateName, startedBy, date }: { productId: string; runId: string; templateName: string; startedBy: string; date: string }) {
  const board = useRunBoard(runId);
  return (
    <div className="panel pad">
      <div className="row-split">
        <div>
          <h3 dir="auto">{templateName}</h3>
          <span className="meta">
            Started by {startedBy} · {new Date(date).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {board ? ` · ${board.flows.length} flows · ${new Set(board.flows.flatMap((f) => f.holders)).size} testers on it` : ""}
          </span>
        </div>
        <Link className="btn primary" to="/products/$productId/runs/$runId" params={{ productId, runId }}>Open the board</Link>
      </div>
      {board ? (
        <div style={{ marginTop: 14 }}>
          <Bar counts={board.counts} total={board.total} />
          <p className="meta" style={{ margin: "8px 0 0" }}>
            {board.counts.pass} passed · {board.counts.fail} failed · {board.counts.minor} minor · {board.counts.skipped} skipped · {board.notReached} not reached yet
          </p>
        </div>
      ) : null}
    </div>
  );
}
