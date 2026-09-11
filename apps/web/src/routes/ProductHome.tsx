/**
 * Product overview (04 §Dashboards): library size, covered vs uncovered, template
 * count, today's run progress, and a "needs attention" list combining uncovered
 * tests, today's failures and today's skipped tests. Laid out as a board — what is
 * happening now on the left, what to start from and what happened before on the right.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRunBoard } from "../lib/run-model.ts";
import { useTestIndex } from "../lib/editor-model.ts";
import { Bar } from "../components/Progress.tsx";
import { type IssueFeed, type Issue } from "../components/Issues.tsx";
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
  useTitle(product.data ? `${product.data.name} — Flowdeck` : "Flowdeck");

  async function start(templateId: string) {
    try {
      const run = await unwrap(api.POST("/templates/{templateId}/runs", { params: { path: { templateId }, query: { force: "false" } } }));
      await qc.invalidateQueries({ queryKey: ["runs", productId] });
      void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId: run.id } });
    } catch (e) {
      // Already open: the day is the answer, not an error.
      if (e instanceof ApiError && e.status === 409) void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId: (e.body as { openRunId: string }).openRunId } });
      else throw e;
    }
  }

  const open = (runs.data ?? []).filter((r) => !r.closedAt);
  const past = (runs.data ?? []).filter((r) => r.closedAt);
  const feeds = useQueries({
    queries: open.map((r) => ({
      queryKey: ["issues", r.id, "home"],
      queryFn: () => unwrap(api.GET("/runs/{runId}/issues", { params: { path: { runId: r.id } } })),
      refetchInterval: 15_000,
    })),
  });
  const { byId } = useTestIndex(productId);
  const disk = useQuery({ queryKey: ["attachments-usage"], queryFn: () => unwrap(api.GET("/attachments/usage")), staleTime: 60_000 });

  if (!product.data) return <main className="shell"><p className="meta">Loading…</p></main>;
  const uncovered = (coverage.data?.tests ?? []).filter((t) => t.needsAttention);
  const todaysIssues = feeds.flatMap((q) => (q.data ? q.data.issues.filter((i) => i.type !== "minor" && i.type !== "pass").map((i) => ({ feed: q.data as IssueFeed, issue: i })) : []));
  const active = (templates.data ?? []).filter((t) => t.status === "active");
  const archivedCount = (templates.data?.length ?? 0) - active.length;
  const cov = coverage.data;
  const pct = cov && cov.total ? Math.round((cov.covered / cov.total) * 100) : 0;

  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1 dir="auto">{product.data.name}</h1>
          <p className="sub" dir="auto">{product.data.description}</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn" to="/products/$productId/tests" params={{ productId }} search={{ test: undefined }}>Test library</Link>
          <Link className="btn primary" to="/products/$productId/templates" params={{ productId }}>Start a testing day</Link>
        </div>
      </div>

      {disk.data?.nearBudget ? (
        <div className="note min" style={{ marginLeft: 0, marginBottom: 16 }}>
          Screenshots are using {Math.round(disk.data.usedBytes / 1048576)} MB of the {Math.round(disk.data.budgetBytes / 1048576)} MB budget.
          Uploads stop when it is full — raise ATTACHMENTS_BUDGET_MB or free the disk.
        </div>
      ) : null}

      <div className="tiles">
        <Link className="tile" to="/products/$productId/tests" params={{ productId }} search={{ test: undefined }}>
          <span className="lbl">Tests in the library</span>
          <span className="num">{cov?.total ?? "–"}</span>
          <span className="foot">Each one a thing that must be true</span>
        </Link>
        <Link className="tile" to="/products/$productId/tests" params={{ productId }} search={{ test: undefined }}>
          <span className="lbl">Covered by a template</span>
          <span className="num">{cov?.covered ?? "–"} <small>{cov ? `${pct}%` : ""}</small></span>
          <span className="foot"><span className="bar"><i className="accent" style={{ width: `${pct}%` }} /></span></span>
        </Link>
        <Link className="tile" to="/products/$productId/tests" params={{ productId }} search={{ test: undefined }}>
          <span className="lbl">Covered by nothing</span>
          <span className={`num ${cov ? (cov.uncovered ? "bad" : "ok") : ""}`}>{cov?.uncovered ?? "–"}</span>
          <span className="foot">{cov?.uncovered ? "Will never be checked on a testing day" : "Every test is reachable by some flow"}</span>
        </Link>
        <Link className="tile" to="/products/$productId/templates" params={{ productId }}>
          <span className="lbl">Templates</span>
          <span className="num">{active.length}</span>
          <span className="foot">{archivedCount ? `${archivedCount} archived` : "One per setup"}</span>
        </Link>
      </div>

      <div className="dash">
        <div className="col">
          <section className="section">
            <div className="head">
              <h2>Today's testing day</h2>
              {open.length ? <span className="meta">{open.length === 1 ? "1 day open" : `${open.length} days open`}</span> : null}
            </div>
            {open.length ? (
              open.map((r) => <OpenRun key={r.id} productId={productId} runId={r.id} templateName={r.templateName} startedBy={r.startedBy} date={r.date} />)
            ) : (
              <div className="empty">
                <b>No testing day is open</b>
                <span>Start one from a template and each tester claims a flow.</span>
                {active[0] ? <button className="btn primary" onClick={() => void start(active[0]!.id)}>Start “{active[0].name}”</button> : null}
              </div>
            )}
          </section>

          <section className="section">
            <div className="head">
              <h2>Needs attention</h2>
              <span className="meta">{uncovered.length + todaysIssues.length ? `${uncovered.length + todaysIssues.length} items` : "Nothing"}</span>
            </div>
            {uncovered.length || todaysIssues.length ? (
              <div className="panel list">
                {uncovered.map((t) => (
                  <div key={t.testId} className="attn">
                    <span className="sig" style={{ background: "var(--color-fail)" }} aria-hidden />
                    <div className="body">
                      <b dir="auto">{byId.get(t.testId)?.current.title ?? "…"}</b>
                      <span className="meta">In no template at all. It will never be checked on a testing day.</span>
                    </div>
                    <Link className="btn sm" to="/products/$productId/tests" params={{ productId }} search={{ test: t.testId }}>Review</Link>
                  </div>
                ))}
                {todaysIssues.map(({ feed, issue }, n) => <AttentionRow key={n} feed={feed} issue={issue} productId={productId} />)}
              </div>
            ) : (
              <div className="empty"><b>All clear</b><span>Every test is covered and nothing has failed today.</span></div>
            )}
          </section>
        </div>

        <div className="col">
          <section className="section">
            <div className="head">
              <h2>Templates</h2>
              <Link className="btn sm" to="/products/$productId/templates" params={{ productId }}>All templates</Link>
            </div>
            {active.length ? (
              <div className="panel list">
                {active.map((t) => (
                  <div key={t.id} className="tplrow">
                    <div className="body">
                      <b><Link to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }} dir="auto">{t.name}</Link></b>
                      <span className="meta">{t.flowCount} {t.flowCount === 1 ? "flow" : "flows"} · marks {t.marksTestCount} tests</span>
                    </div>
                    <button className="btn sm soft" onClick={() => void start(t.id)}>Start</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <b>No templates yet</b>
                <Link className="btn sm primary" to="/products/$productId/templates" params={{ productId }}>Create one</Link>
              </div>
            )}
          </section>

          <section className="section">
            <div className="head">
              <h2>Past testing days</h2>
              {past.length ? <span className="meta">{past.length}</span> : null}
            </div>
            {past.length ? (
              <div className="panel list">
                {past.slice(0, 8).map((r) => (
                  <Link key={r.id} className="histrow" to="/products/$productId/runs/$runId" params={{ productId, runId: r.id }}>
                    <span dir="auto" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.templateName}</span>
                    <span className="meta">{new Date(r.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="meta" style={{ margin: 0 }}>Closed days appear here with their reports.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

const ATTN: Record<Issue["type"], { label: string; color: string }> = {
  failure: { label: "Failed today", color: "var(--color-fail)" },
  minor: { label: "Minor", color: "var(--color-minor)" },
  invalid_test: { label: "Test is wrong", color: "var(--color-skip)" },
  pass: { label: "Passed", color: "var(--color-pass)" },
};

function AttentionRow({ feed, issue, productId }: { feed: IssueFeed; issue: Issue; productId: string }) {
  const a = ATTN[issue.type];
  return (
    <div className="attn">
      <span className="sig" style={{ background: a.color }} aria-hidden />
      <div className="body">
        <b dir="auto">{issue.test.title}</b>
        <span className="meta" dir="auto">
          {a.label} · {feed.run.template}, {issue.context.flow} step {issue.context.stepNumber} · {issue.recordedBy}
          {issue.type === "failure" && issue.blocking ? " · blocked the rest of the flow" : ""}
        </span>
        {issue.note ? <div className={`note${issue.type === "invalid_test" ? " skp" : ""}`} dir="auto">{issue.note}</div> : null}
      </div>
      <Link className="btn sm" to="/products/$productId/tests" params={{ productId }} search={{ test: issue.test.id }}>{issue.type === "invalid_test" ? "Rewrite" : "Open test"}</Link>
    </div>
  );
}

/** An open day's card, with its progress live off the same collections the board uses. */
function OpenRun({ productId, runId, templateName, startedBy, date }: { productId: string; runId: string; templateName: string; startedBy: string; date: string }) {
  const board = useRunBoard(runId);
  const testers = board ? new Set(board.flows.flatMap((f) => f.holders)).size : 0;
  const done = board ? board.total - board.notReached : 0;
  return (
    <div className="panel pad daycard">
      <div className="row-split">
        <div style={{ minWidth: 0 }}>
          <h3 dir="auto" style={{ margin: 0 }}>{templateName}</h3>
          <span className="meta">
            Started by {startedBy} at {new Date(date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {board ? ` · ${board.flows.length} flows · ${testers === 1 ? "1 tester" : `${testers} testers`} on it` : ""}
          </span>
        </div>
        <Link className="btn primary" to="/products/$productId/runs/$runId" params={{ productId, runId }}>Open the board</Link>
      </div>
      {board ? (
        <div style={{ marginTop: 14 }}>
          <div className="row-split" style={{ marginBottom: 6 }}>
            <span className="meta">{done} of {board.total} tests reached</span>
            <span className="meta">{board.total ? Math.round((done / board.total) * 100) : 0}%</span>
          </div>
          <Bar counts={board.counts} total={board.total} />
          <div className="counts">
            <span><span className="dot" style={{ color: "var(--color-pass)" }} /><b>{board.counts.pass}</b> passed</span>
            <span><span className="dot" style={{ color: "var(--color-fail)" }} /><b>{board.counts.fail}</b> failed</span>
            <span><span className="dot" style={{ color: "var(--color-minor)" }} /><b>{board.counts.minor}</b> minor</span>
            <span><span className="dot" style={{ color: "var(--color-skip)" }} /><b>{board.counts.skipped}</b> skipped</span>
            <span><b>{board.notReached}</b> not reached</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
