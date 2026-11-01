/**
 * The test library: a flat searchable list of assertions.
 * Coverage chips are live — mark a test in the editor in another tab and the
 * red row here turns quiet without a reload (product.marks / product.tests).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Test } from "../lib/api.ts";
import { useLiveCoverage, useTestIndex } from "../lib/editor-model.ts";
import { useLiveResults } from "../lib/run-model.ts";
import { worstResultByTest, type Verdict } from "@flowdeck/domain";
import { useTitle } from "../lib/title.ts";
import { FilterBar } from "../components/Filters.tsx";

type Filter = "all" | "uncovered";

export function TestLibrary() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const search = useSearch({ strict: false }) as { test?: string };
  const qc = useQueryClient();
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => unwrap(api.GET("/products/{product}", { params: { path: { product: productId } } })) });
  const { tests, ready } = useTestIndex(productId);
  const coverage = useLiveCoverage(productId);
  const templates = useQuery({ queryKey: ["templates", productId], queryFn: () => unwrap(api.GET("/products/{productId}/templates", { params: { path: { productId } } })) });
  const covered = useQuery({ queryKey: ["coverage", productId], queryFn: () => unwrap(api.GET("/products/{productId}/coverage", { params: { path: { productId } } })) });
  const templateName = (id: string) => templates.data?.find((t) => t.id === id)?.name ?? "…";
  const runs = useQuery({ queryKey: ["runs", productId], queryFn: () => unwrap(api.GET("/products/{productId}/runs", { params: { path: { productId } } })) });
  // "Today" is the most recent open day; its verdicts come live off the run's results shape.
  const today = (runs.data ?? []).filter((r) => !r.closedAt).sort((a, b) => b.date.localeCompare(a.date))[0];
  const todayVerdicts = useTodayVerdicts(today?.id);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [tplFilter, setTplFilter] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(search.test ?? null);
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  // One line per test, for a library in the hundreds. Remembered per browser.
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem("flowdeck.library.compact") === "1"; } catch { return false; } });
  const toggleCompact = () => setCompact((c) => { try { localStorage.setItem("flowdeck.library.compact", c ? "0" : "1"); } catch { /* fine */ } return !c; });
  useTitle(product.data ? `Tests · ${product.data.name} — Flowdeck` : "Flowdeck");
  useEffect(() => {
    if (!search.test) return;
    setSelected(search.test);
    // Arriving from a step card: bring the opened row into view.
    requestAnimationFrame(() => document.getElementById(`test-${search.test}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [search.test]);

  const templatesOf = (id: string) => covered.data?.tests.find((c) => c.testId === id)?.templateIds ?? [];
  const allTags = useMemo(() => [...new Set(tests.filter((t) => !t.archived).flatMap(tagsOf))].sort(), [tests]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tests
      .filter((t) => showArchived || !t.archived)
      .filter((t) => filter !== "uncovered" || (!t.archived && coverage.markCount(t.id) === 0))
      .filter((t) => !tagFilter.size || [...tagFilter].every((g) => tagsOf(t).includes(g)))
      .filter((t) => !tplFilter || templatesOf(t.id).includes(tplFilter))
      .filter((t) => !needle || t.current.title.toLowerCase().includes(needle) || t.current.expectedResult.toLowerCase().includes(needle) || tagsOf(t).some((g) => g.includes(needle)))
      .sort((a, b) => a.current.title.localeCompare(b.current.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests, q, filter, showArchived, tagFilter, tplFilter, coverage, covered.data]);
  const toggleTag = (g: string) => setTagFilter((prev) => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const live = tests.filter((t) => !t.archived);
  const uncovered = live.filter((t) => coverage.markCount(t.id) === 0).length;
  const current = tests.find((t) => t.id === selected) ?? null;

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["tests", productId] }),
    qc.invalidateQueries({ queryKey: ["coverage", productId] }),
  ]);

  async function create(title: string, expectedResult: string, tags: string[]) {
    const [t] = await unwrap(api.POST("/products/{productId}/tests", { params: { path: { productId } }, body: { tests: [{ title, expectedResult, metadata: tags.length ? { tags } : {}, archived: false }] } }));
    await refresh();
    setDialog(null);
    if (t) setSelected(t.id);
  }

  async function edit(title: string, expectedResult: string, tags: string[]) {
    if (!current) return;
    await unwrap(api.PATCH("/tests/{testId}", { params: { path: { testId: current.id } }, body: { title, expectedResult, metadata: { ...current.current.metadata, tags } } }));
    await refresh();
    setDialog(null);
  }

  if (!ready) return <main className="shell"><p className="meta">Loading the library…</p></main>;

  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1>Tests</h1>
          <p className="sub">Each test is one thing to verify. How you get there lives in a flow, not here.</p>
        </div>
        <button className="btn primary" onClick={() => setDialog("new")}>Add test</button>
      </div>

      <FilterBar
        q={q}
        onSearch={setQ}
        placeholder="Search tests, expected results or tags"
        count={{ shown: rows.length, total: showArchived ? tests.length : live.length }}
        archived={{ shown: showArchived, total: tests.length - live.length, onToggle: setShowArchived }}
      >
        <div className="flex gap-2 flex-wrap items-center">
          <button className={`btn sm${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All ({live.length})</button>
          <button className={`btn sm${filter === "uncovered" ? " on" : ""}`} style={uncovered && filter !== "uncovered" ? { borderColor: "var(--pill-fail-line)", color: "var(--color-fail)" } : undefined} onClick={() => setFilter("uncovered")}>Uncovered only ({uncovered})</button>
          <select className="compact" value={tplFilter} onChange={(e) => setTplFilter(e.target.value)} aria-label="Covered by template">
            <option value="">Any template</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.status === "archived" ? " (archived)" : ""}</option>)}
          </select>
          <button className={`btn sm${compact ? " on" : ""}`} aria-pressed={compact} onClick={toggleCompact} title="One line per test">Compact rows</button>
        </div>
      </FilterBar>
      {allTags.length ? (
        <div className="chips" role="group" aria-label="Filter by tag" style={{ margin: "-6px 0 18px" }}>
          <span className="meta" style={{ fontSize: 12.5, marginRight: 2 }}>Tags</span>
          {allTags.map((g) => (
            <button key={g} type="button" className={`chip${tagFilter.has(g) ? " on" : ""}`} aria-pressed={tagFilter.has(g)} onClick={() => toggleTag(g)}>{g}</button>
          ))}
          {tagFilter.size || tplFilter ? <button type="button" className="chip" style={{ borderStyle: "dashed" }} onClick={() => { setTagFilter(new Set()); setTplFilter(""); }}>Clear</button> : null}
        </div>
      ) : null}

      <div className="tbl" style={{ overflowX: "auto" }}>
        <table className={compact ? "compact" : undefined}>
          <thead><tr><th>Test</th><th style={{ width: 260 }}>Covered by</th><th style={{ width: 130 }}>Today</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const n = coverage.markCount(t.id);
              const tplIds = templatesOf(t.id);
              const isSel = t.id === selected;
              return (
                <Fragment key={t.id}>
                  <tr id={`test-${t.id}`} style={{ scrollMarginTop: 72 }} className={`pick${!t.archived && n === 0 ? " uncov" : ""}${isSel ? " sel" : ""}`} onClick={() => setSelected(isSel ? null : t.id)} aria-expanded={isSel}>
                    <td>{compact ? (
                      <span className="oneline" title={t.current.expectedResult}><b dir="auto">{t.current.title}</b> <span className="meta" dir="auto">— {t.current.expectedResult}</span></span>
                    ) : (<>
                      <b dir="auto">{t.current.title}</b><br /><span className="meta" dir="auto">{t.current.expectedResult}</span>
                      {tagsOf(t).length ? <div className="mt-1 flex gap-1 flex-wrap">{tagsOf(t).map((g) => <span key={g} className="tag">{g}</span>)}</div> : null}
                    </>)}
                    </td>
                    <td>
                      {t.archived ? <span className="tag">archived</span>
                        : n === 0 ? <span className="pill fail"><span className="dot" />Not in any template</span>
                        : <div className="flex gap-1 flex-wrap">{tplIds.map((id) => <span key={id} className="tag" dir="auto">{templateName(id)}</span>)}{tplIds.length === 0 ? <span className="meta">{n} step{n === 1 ? "" : "s"}</span> : null}</div>}
                    </td>
                    <td><TodayPill verdict={todayVerdicts.get(t.id)} /></td>
                  </tr>
                  {isSel ? (
                    <tr className="detail">
                      <td colSpan={3}>
                        <div className="tdetail-wrap" key={t.id}><div>
                          <TestDetail test={t} productId={productId} onEdit={() => setDialog("edit")} onChanged={refresh} onClose={() => setSelected(null)} />
                        </div></div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!rows.length ? <tr><td colSpan={3} className="meta">Nothing matches{tests.length - live.length && !showArchived ? " — archived tests are hidden" : ""}.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <TestDialog
        open={dialog !== null}
        mode={dialog ?? "new"}
        test={dialog === "edit" ? current : null}
        onSubmit={dialog === "edit" ? edit : create}
        onClose={() => setDialog(null)}
      />
    </main>
  );
}

function tagsOf(t: Test): string[] {
  const tags = (t.current.metadata as { tags?: unknown }).tags;
  return Array.isArray(tags) ? tags.filter((x): x is string => typeof x === "string") : [];
}

function TestDetail({ test, productId, onEdit, onChanged, onClose }: { test: Test; productId: string; onEdit: () => void; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const usages = useQuery({ queryKey: ["usages", test.id], queryFn: () => unwrap(api.GET("/tests/{testId}/usages", { params: { path: { testId: test.id } } })) });
  const history = useQuery({ queryKey: ["history", test.id], queryFn: () => unwrap(api.GET("/tests/{testId}/history", { params: { path: { testId: test.id } } })) });
  const versions = useQuery({ queryKey: ["versions", test.id], queryFn: () => unwrap(api.GET("/tests/{testId}/versions", { params: { path: { testId: test.id } } })), enabled: false });
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setShowHistory(false); setConfirming(false); }, [test.id]);

  async function archive(undo: boolean) {
    await unwrap(api.POST("/tests/{testId}/archive", { params: { path: { testId: test.id }, query: { undo: undo ? "true" : "false" } } }));
    setConfirming(false);
    await onChanged();
  }

  const u = usages.data;
  return (
    <div className="tdetail" onClick={(e) => e.stopPropagation()}>
        <div className="row-split">
          <div>
            <h3 dir="auto">{test.current.title} {test.archived ? <span className="tag">archived</span> : null}</h3>
            <p className="meta" style={{ margin: "2px 0 0" }}>
              Version {test.current.version} · edited by {test.current.createdBy} on {new Date(test.current.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
              {u ? ` · marked by ${u.steps} step${u.steps === 1 ? "" : "s"} in ${u.flows} flow${u.flows === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!test.archived ? <button className="btn sm primary" onClick={onEdit}>Edit</button> : null}
            <button className="btn sm" onClick={() => { setShowHistory((h) => !h); if (!versions.data) void versions.refetch(); }}>{showHistory ? "Hide versions" : "Version history"}</button>
            {test.archived
              ? <button className="btn sm" onClick={() => void archive(true)}>Restore</button>
              : <button className="btn sm" onClick={() => setConfirming(true)}>Archive</button>}
            <button className="btn sm" onClick={onClose} aria-label="Close detail">Close</button>
          </div>
        </div>

        {confirming && u ? (
          <div className="note skp" style={{ marginLeft: 0 }}>
            <b>Archive this test?</b> It is marked by {u.steps} step{u.steps === 1 ? "" : "s"} in {u.flows} flow{u.flows === 1 ? "" : "s"} across {u.templates} template{u.templates === 1 ? "" : "s"}.
            Those steps keep the mark but it stops counting toward coverage; testing days already recorded stay as they are. Nothing is deleted.
            <div className="flex gap-2 mt-2">
              <button className="btn sm danger" onClick={() => void archive(false)}>Archive</button>
              <button className="btn sm" onClick={() => setConfirming(false)}>Keep it</button>
            </div>
          </div>
        ) : null}

        <label className="f">Expected result</label>
        <div className="pre" style={{ marginTop: 0 }} dir="auto">{test.current.expectedResult}</div>
        {tagsOf(test).length ? (<><label className="f">Tags</label><div className="flex gap-1 flex-wrap">{tagsOf(test).map((g) => <span key={g} className="tag">{g}</span>)}</div></>) : null}

        <label className="f">Marked by these steps</label>
        {u && u.usages.length === 0 ? <p className="meta" style={{ margin: 0 }}>Nothing marks this test. It will never be checked on a testing day.</p> : null}
        <div className="stack">
          {(u?.usages ?? []).map((x) => (
            <Link key={x.stepId} className="panel pad row-split lnk" style={{ background: "var(--surface-3)" }} to="/products/$productId/templates/$templateId/flows/$flowId" params={{ productId, templateId: x.templateId, flowId: x.flowId }} hash={`step-${x.stepId}`}>
              <span dir="auto"><span className="tag">{x.deviceLabel}</span> <span style={{ marginLeft: 6 }}>{x.stepText}</span></span>
              <span className="meta" dir="auto">{x.templateName}{x.templateStatus === "archived" ? " (archived)" : ""} → {x.flowName}, step {x.stepIndex + 1}</span>
            </Link>
          ))}
        </div>

        <label className="f">Over time</label>
        {history.data && history.data.length === 0 ? <p className="meta" style={{ margin: 0 }}>Never executed.</p> : null}
        {history.data && history.data.length ? (
          <div className="tbl"><table><tbody>
            {history.data.map((h, i) => (
              <tr key={i}>
                <td style={{ width: 130 }} className="meta">{new Date(h.runDate).toLocaleDateString()}</td>
                <td style={{ width: 120 }}><TodayPill verdict={h.verdict} /></td>
                <td>
                  <span dir="auto">{h.template} → {h.flow}</span>
                  <span className="meta"> · v{h.version} · {h.recordedBy}</span>
                  {h.note ? <div className="meta" dir="auto" style={{ marginTop: 2 }}>{h.note}</div> : null}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : null}

        {showHistory ? (
          <>
            <label className="f">Version history</label>
            <div className="tbl"><table><tbody>
              {(versions.data ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="tid" style={{ width: 60 }}>v{v.version}</td>
                  <td><b dir="auto">{v.title}</b><br /><span className="meta" dir="auto">{v.expectedResult}</span></td>
                  <td className="meta" style={{ width: 200 }}>{v.createdBy} · {new Date(v.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody></table></div>
          </>
        ) : null}
    </div>
  );
}

function TestDialog({ open, mode, test, onSubmit, onClose }: { open: boolean; mode: "new" | "edit"; test: Test | null; onSubmit: (title: string, expected: string, tags: string[]) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [expected, setExpected] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTitle(test?.current.title ?? "");
    setExpected(test?.current.expectedResult ?? "");
    setTags(test ? tagsOf(test).join(", ") : "");
    setError(null);
  }, [open, test]);
  const canSubmit = !busy && title.trim().length > 0 && expected.trim().length > 0;
  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try { await onSubmit(title.trim(), expected.trim(), tags.split(",").map((s) => s.trim()).filter(Boolean)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(); }}>
          <Dialog.Title asChild><h3>{mode === "edit" ? "Edit test" : "New test"}</h3></Dialog.Title>
          <Dialog.Description asChild>
            <p className="meta" style={{ margin: "0 0 4px", fontSize: 13 }}>
              {mode === "edit" && test
                ? `Editing creates version ${test.current.version + 1}. Flows keep pointing at this test and pick up the new wording automatically. Runs already recorded stay attached to the version they ran against.`
                : "State the thing that must be true — not how to get there. The route lives in a flow."}
            </p>
          </Dialog.Description>
          <label className="f" htmlFor="t-title">Title</label>
          <input id="t-title" type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" placeholder="Queued messages send on reconnect" />
          <label className="f" htmlFor="t-expected">Expected result</label>
          <textarea id="t-expected" value={expected} onChange={(e) => setExpected(e.target.value)} dir="auto" placeholder="All queued messages send in their original order once connectivity returns." />
          <label className="f" htmlFor="t-tags">Tags <span className="meta">(comma separated, optional)</span></label>
          <input id="t-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="sync, offline" />
          {error ? <p className="note" style={{ marginLeft: 0 }}>{error}</p> : null}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>{mode === "edit" ? `Save as version ${(test?.current.version ?? 0) + 1}` : "Add test"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const PILL: Record<Verdict, [string, string]> = { pass: ["pass", "Passed"], fail: ["fail", "Failed"], minor: ["minor", "Minor"], skipped: ["skip", "Test is wrong"] };

function TodayPill({ verdict }: { verdict: Verdict | undefined }) {
  if (!verdict) return <span className="meta">—</span>;
  const [cls, label] = PILL[verdict];
  return <span className={`pill ${cls}`}><span className="dot" />{label}</span>;
}

/** A nil run id keeps the hook order stable when no day is open; its shape is simply empty. */
const NO_RUN = "00000000-0000-4000-8000-000000000000";

function useTodayVerdicts(runId: string | undefined) {
  const { rows } = useLiveResults(runId ?? NO_RUN);
  return useMemo(
    () => (runId ? worstResultByTest(rows.map((r) => ({ testId: r.test_id, verdict: r.verdict }))) : new Map<string, Verdict>()),
    [rows, runId],
  );
}
