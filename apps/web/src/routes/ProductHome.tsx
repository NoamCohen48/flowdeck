/** Product overview, milestone-3 cut: templates to start a day from, and recent days. */
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

  if (!product.data) return <main className="shell"><p className="meta">Loading…</p></main>;
  const open = (runs.data ?? []).filter((r) => !r.closedAt);

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
          {open.map((r) => (
            <div key={r.id} className="panel pad row-split">
              <div>
                <h3 dir="auto">{r.templateName}</h3>
                <span className="meta">Started by {r.startedBy} · {new Date(r.date).toLocaleString()}</span>
              </div>
              <Link className="btn primary" to="/products/$productId/runs/$runId" params={{ productId, runId: r.id }}>Open the board</Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta">No testing day is open. Start one from a template below.</p>
      )}

      <h2>Templates</h2>
      <div className="stack">
        {(templates.data ?? []).map((t) => (
          <div key={t.id} className="panel pad">
            <div className="row-split">
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 dir="auto">{t.name} {t.status === "archived" ? <span className="tag">archived</span> : null}</h3>
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
