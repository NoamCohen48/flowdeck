/**
 * A product's templates: one per setup, each a named collection of flows. This is
 * where a day gets started from and where new templates are made; the overview
 * only summarises them.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { useTitle } from "../lib/title.ts";
import { FilterBar } from "../components/Filters.tsx";

export function Templates() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => unwrap(api.GET("/products/{product}", { params: { path: { product: productId } } })) });
  const templates = useQuery({ queryKey: ["templates", productId], queryFn: () => unwrap(api.GET("/products/{productId}/templates", { params: { path: { productId } } })) });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [warn, setWarn] = useState<{ templateId: string; openRunId: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useTitle(product.data ? `Templates · ${product.data.name} — Flowdeck` : "Flowdeck");

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

  const all = templates.data ?? [];
  const archivedTotal = all.filter((t) => t.status === "archived").length;
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle));
  }, [all, q]);
  const active = matching.filter((t) => t.status === "active");
  const archived = showArchived ? matching.filter((t) => t.status === "archived") : [];
  const narrowed = q.trim().length > 0;

  return (
    <main className="shell">
      <div className="pagehead">
        <div>
          <h1>Templates</h1>
          <p className="sub">One template per setup. A testing day starts from a template and runs against a snapshot of it.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>New template</button>
      </div>

      {all.length ? (
        <FilterBar
          q={q}
          onSearch={setQ}
          placeholder="Search templates"
          count={{ shown: active.length + archived.length, total: all.length - (showArchived ? 0 : archivedTotal) }}
          archived={{ shown: showArchived, total: archivedTotal, onToggle: setShowArchived }}
        />
      ) : null}

      <div className="grid gap-4">
        {creating ? <NewTemplate onSave={createTemplate} onCancel={() => setCreating(false)} /> : null}

        {active.map((t) => (
          <div key={t.id} className="panel tplcard">
            <div className="top">
              <div style={{ minWidth: 0 }}>
                <h3><Link to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }} dir="auto">{t.name}</Link></h3>
                <p className="meta" style={{ margin: "3px 0 0" }} dir="auto">{t.description || "No description yet — say what setup this template targets."}</p>
              </div>
              <div className="flex gap-2 flex-none">
                <Link className="btn" to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }}>Edit flows</Link>
                <button className="btn primary" onClick={() => void start(t.id)}>Start a testing day</button>
              </div>
            </div>
            <div className="stats">
              <span><b>{t.flowCount}</b> {t.flowCount === 1 ? "flow" : "flows"}</span>
              <span><b>{t.marksTestCount}</b> {t.marksTestCount === 1 ? "test" : "tests"} marked</span>
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

        {templates.data && !active.length && !archived.length && !creating ? (
          narrowed ? (
            <div className="empty">
              <b>No templates match “{q.trim()}”</b>
              <span>{archivedTotal && !showArchived ? "Archived templates are hidden — switch them on to search those too." : "Try another word from the name or description."}</span>
              <button className="btn" onClick={() => setQ("")}>Clear search</button>
            </div>
          ) : all.length ? (
            <div className="empty">
              <b>Every template is archived</b>
              <span>Nothing runs from an archived template. Show them to restore one, or start fresh.</span>
              <div className="flex gap-2"><button className="btn" onClick={() => setShowArchived(true)}>Show archived</button><button className="btn primary" onClick={() => setCreating(true)}>New template</button></div>
            </div>
          ) : (
            <div className="empty">
              <b>No templates yet</b>
              <span>A template is the set of flows for one setup — a fresh install, an upgraded account, a two-device lab.</span>
              <button className="btn primary" onClick={() => setCreating(true)}>Create the first template</button>
            </div>
          )
        ) : null}

        {archived.length ? (
          <>
            <h2 style={{ margin: "14px 0 0" }}>Archived</h2>
            <p className="meta" style={{ margin: "-6px 0 0" }}>Kept for coverage history. Nothing runs from these.</p>
            {archived.map((t) => (
              <div key={t.id} className="panel tplcard archived">
                <div className="top">
                  <div style={{ minWidth: 0 }}>
                    <h3><Link to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }} dir="auto">{t.name}</Link> <span className="tag">archived</span></h3>
                    <p className="meta" style={{ margin: "3px 0 0" }} dir="auto">{t.description}</p>
                  </div>
                  <Link className="btn" to="/products/$productId/templates/$templateId" params={{ productId, templateId: t.id }}>Open</Link>
                </div>
                <div className="stats">
                  <span><b>{t.flowCount}</b> {t.flowCount === 1 ? "flow" : "flows"}</span>
                  <span><b>{t.marksTestCount}</b> {t.marksTestCount === 1 ? "test" : "tests"} marked</span>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </main>
  );
}

function NewTemplate({ onSave, onCancel }: { onSave: (name: string, description: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="panel pad" style={{ borderColor: "var(--primary-line)" }}>
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
