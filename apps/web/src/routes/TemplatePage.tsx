/**
 * A template: its flows, and what they add up to. Coverage here is a report,
 * never a form — "covers 20 of 25" is whatever the flows happen to mark (D1).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { computeHandoffs } from "@flowdeck/domain";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { useTestIndex } from "../lib/editor-model.ts";
import { useTitle } from "../lib/title.ts";
import { DeviceChip, templateSlots } from "../components/Device.tsx";
import { FilterBar } from "../components/Filters.tsx";

export function TemplatePage() {
  const { productId, templateId } = useParams({ strict: false }) as { productId: string; templateId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const template = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => unwrap(api.GET("/templates/{templateId}", { params: { path: { templateId } } })),
  });
  const scope = useQuery({
    queryKey: ["template-scope", templateId],
    queryFn: () => unwrap(api.GET("/templates/{templateId}/scope", { params: { path: { templateId } } })),
  });
  const { byId } = useTestIndex(productId);
  const [showMisses, setShowMisses] = useState(false);
  const [adding, setAdding] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [device, setDevice] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  useTitle(template.data ? `${template.data.name} — Flowdeck` : "Flowdeck");

  // Archived flows are hidden until asked for; the rest narrows by words in the
  // flow or by the device it needs. Devices come from the live flows only.
  const flows = template.data?.flows ?? [];
  const archivedTotal = flows.filter((f) => f.archived).length;
  const withDevices = useMemo(() => {
    const slots = templateSlots(flows);
    return flows.map((f) => ({ flow: f, devices: computeHandoffs(f.steps, slots).devices }));
  }, [flows]);
  const allDevices = useMemo(() => [...new Set(withDevices.filter((x) => !x.flow.archived).flatMap((x) => x.devices.map((d) => d.label)))], [withDevices]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withDevices.filter(({ flow: f, devices }) =>
      (showArchived || !f.archived)
      && (!device || devices.some((d) => d.label === device))
      && (!needle || f.name.toLowerCase().includes(needle) || f.precondition.toLowerCase().includes(needle) || f.steps.some((st) => st.text.toLowerCase().includes(needle))));
  }, [withDevices, q, device, showArchived]);
  const narrowed = q.trim().length > 0 || device !== "";
  // Positions are meaningful across the whole list, so reordering needs the whole list on screen.
  const canReorder = !narrowed && !showArchived;

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["template", templateId] }),
    qc.invalidateQueries({ queryKey: ["template-scope", templateId] }),
    qc.invalidateQueries({ queryKey: ["templates", productId] }),
    qc.invalidateQueries({ queryKey: ["coverage", productId] }),
  ]);

  async function patch(body: { name?: string; description?: string; status?: "active" | "archived" }) {
    await unwrap(api.PATCH("/templates/{templateId}", { params: { path: { templateId } }, body }));
    await refresh();
  }

  async function addFlow(name: string) {
    const flow = await unwrap(api.POST("/templates/{templateId}/flows", { params: { path: { templateId } }, body: { name, precondition: "", estimatedMinutes: null, archived: false, steps: [] } }));
    await refresh();
    void navigate({ to: "/products/$productId/templates/$templateId/flows/$flowId", params: { productId, templateId, flowId: flow.id } });
  }

  /** Archive, never delete: history keeps its steps, coverage keeps its marks (D3, D7). */
  async function setFlowArchived(flowId: string, archived: boolean) {
    await unwrap(api.PATCH("/flows/{flowId}", { params: { path: { flowId } }, body: { archived } }));
    await refresh();
  }

  async function move(flowId: string, dir: -1 | 1) {
    const ids = (template.data?.flows ?? []).map((f) => f.id);
    const i = ids.indexOf(flowId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await unwrap(api.PUT("/templates/{templateId}/flows/order", { params: { path: { templateId } }, body: { ids } }));
    await refresh();
  }

  async function start(force = false) {
    try {
      const run = await unwrap(api.POST("/templates/{templateId}/runs", { params: { path: { templateId }, query: { force: force ? "true" : "false" } } }));
      await qc.invalidateQueries({ queryKey: ["runs", productId] });
      void navigate({ to: "/products/$productId/runs/$runId", params: { productId, runId: run.id } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setWarn((e.body as { openRunId: string }).openRunId);
      else throw e;
    }
  }

  if (template.isPending) return <main className="shell"><p className="meta">Loading…</p></main>;
  if (!template.data) return <main className="shell"><p className="note">This template does not exist.</p></main>;
  const tpl = template.data;
  const archived = tpl.status === "archived";

  return (
    <main className="shell">
      <p className="crumb"><Link to="/products/$productId/templates" params={{ productId }} className="lnk">Templates</Link> › <span dir="auto">{tpl.name}</span></p>

      <div className="row-split">
        <div style={{ flex: 1, minWidth: 240 }}>
          <Editable value={tpl.name} onSave={(name) => patch({ name })} as="h1" placeholder="Template name" />
          <Editable value={tpl.description} onSave={(description) => patch({ description })} as="p" placeholder="Describe the setup this template targets — that is the whole reason several templates exist." />
        </div>
        <div className="flex gap-2 items-center">
          {archived ? <span className="tag">Archived</span> : <button className="btn primary" onClick={() => void start()}>Start a testing day</button>}
          <button className="btn" onClick={() => void patch({ status: archived ? "active" : "archived" })}>{archived ? "Restore" : "Archive"}</button>
        </div>
      </div>
      {warn ? (
        <div className="note skp" style={{ marginLeft: 0 }}>
          A testing day is already open for this template.
          <div className="flex gap-2 mt-2">
            <Link className="btn sm primary" to="/products/$productId/runs/$runId" params={{ productId, runId: warn }}>Open it</Link>
            <button className="btn sm" onClick={() => void start(true)}>Start another anyway</button>
            <button className="btn sm" onClick={() => setWarn(null)}>Never mind</button>
          </div>
        </div>
      ) : null}

      <div className="panel pad" style={{ margin: "18px 0 22px" }}>
        <div className="row-split">
          <div>
            <h3>{scope.data ? `This template covers ${scope.data.covers} of ${scope.data.productTotal} tests` : "…"}</h3>
            <p className="meta" style={{ margin: "2px 0 0" }}>Coverage is whatever its flows happen to mark — there is nothing to declare up front.</p>
          </div>
          {scope.data?.misses.length ? <button className="btn sm" onClick={() => setShowMisses((v) => !v)}>{showMisses ? "Hide" : "See what it misses"} ({scope.data.misses.length})</button> : null}
        </div>
        {showMisses && scope.data ? (
          <ul className="m-0 mt-3 p-0 list-none grid gap-1">
            {scope.data.misses.map((id) => (
              <li key={id} className="meta" dir="auto">· {byId.get(id)?.current.title ?? id}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="row-split">
        <h2 style={{ margin: 0 }}>Flows</h2>
        <button className="btn sm" onClick={() => setAdding(true)}>＋ Add flow</button>
      </div>
      {tpl.flows.length > 1 || archivedTotal ? (
        <div style={{ marginTop: 12 }}>
          <FilterBar
            q={q}
            onSearch={setQ}
            placeholder="Search flows and their steps"
            count={{ shown: visible.length, total: showArchived ? tpl.flows.length : tpl.flows.length - archivedTotal }}
            archived={{ shown: showArchived, total: archivedTotal, onToggle: setShowArchived }}
          >
            {allDevices.length > 1 ? (
              <div className="chips" role="group" aria-label="Filter by device">
                {allDevices.map((label) => (
                  <button key={label} type="button" className={`chip${device === label ? " on" : ""}`} aria-pressed={device === label} onClick={() => setDevice(device === label ? "" : label)} dir="auto">{label}</button>
                ))}
              </div>
            ) : null}
          </FilterBar>
        </div>
      ) : null}
      <div className="stack" style={{ marginTop: tpl.flows.length > 1 || archivedTotal ? 0 : 12 }}>
        {visible.map(({ flow: f, devices }) => {
          const i = tpl.flows.findIndex((x) => x.id === f.id);
          const marked = new Set(f.steps.flatMap((s) => s.marks)).size;
          return (
            <div key={f.id} className={`panel pad row-split${f.archived ? " archivedrow" : ""}`}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3><Link to="/products/$productId/templates/$templateId/flows/$flowId" params={{ productId, templateId, flowId: f.id }} className="lnk" dir="auto">{f.name}</Link>{f.archived ? <span className="tag" style={{ marginLeft: 8 }}>archived</span> : null}</h3>
                <p className="meta" style={{ margin: "2px 0 0" }}>{f.steps.length} steps · marks {marked} tests{f.estimatedMinutes ? ` · ~${f.estimatedMinutes} min` : ""}</p>
              </div>
              <div className="flex gap-1.5 flex-wrap">{devices.map((d) => <DeviceChip key={d.label} device={d} ghost />)}</div>
              <div className="flex gap-1">
                {f.archived ? (
                  <button className="btn sm" onClick={() => void setFlowArchived(f.id, false)}>Restore</button>
                ) : (
                  <>
                    <button className="btn sm" disabled={!canReorder || i === 0} onClick={() => void move(f.id, -1)} aria-label="Move up" title={canReorder ? undefined : "Show every live flow, unfiltered, to reorder"}>↑</button>
                    <button className="btn sm" disabled={!canReorder || i === tpl.flows.length - 1} onClick={() => void move(f.id, 1)} aria-label="Move down" title={canReorder ? undefined : "Show every live flow, unfiltered, to reorder"}>↓</button>
                    <Link className="btn sm" to="/products/$productId/templates/$templateId/flows/$flowId" params={{ productId, templateId, flowId: f.id }}>Edit</Link>
                    <button className="btn sm" onClick={() => void setFlowArchived(f.id, true)}>Archive</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {adding ? <NewFlow onSave={addFlow} onCancel={() => setAdding(false)} /> : null}
        {!tpl.flows.length && !adding ? <p className="meta">No flows yet. A flow is what one tester does in one sitting — a path through the product, with checks along the way.</p> : null}
        {tpl.flows.length && !visible.length ? (
          narrowed ? (
            <div className="empty">
              <b>No flows match</b>
              <span>{device ? `No flow${q.trim() ? ` mentioning “${q.trim()}”` : ""} uses “${device}”.` : `Nothing here mentions “${q.trim()}”.`}{archivedTotal && !showArchived ? " Archived flows are hidden." : ""}</span>
              <button className="btn" onClick={() => { setQ(""); setDevice(""); }}>Clear</button>
            </div>
          ) : (
            <div className="empty">
              <b>Every flow is archived</b>
              <span>A testing day started now would have nothing to run. Show them to restore one, or add a flow.</span>
              <div className="flex gap-2"><button className="btn" onClick={() => setShowArchived(true)}>Show archived</button><button className="btn primary" onClick={() => setAdding(true)}>Add flow</button></div>
            </div>
          )
        ) : null}
      </div>
    </main>
  );
}

function NewFlow({ onSave, onCancel }: { onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="panel pad">
      <label className="f" htmlFor="new-flow" style={{ marginTop: 0 }}>Flow name</label>
      <div className="flex gap-2">
        <input id="new-flow" type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="Messaging across two devices" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void onSave(name.trim()); if (e.key === "Escape") onCancel(); }} />
        <button className="btn primary" disabled={!name.trim()} onClick={() => void onSave(name.trim())}>Create and edit</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Click-to-edit text: a heading or paragraph that becomes an input and saves on blur. */
function Editable({ value, onSave, as, placeholder }: { value: string; onSave: (v: string) => Promise<void>; as: "h1" | "p"; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { setEditing(false); if (v.trim() !== value && (as === "p" || v.trim())) void onSave(v.trim()); else setV(value); };
  if (editing) {
    return as === "h1"
      ? <input type="text" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setV(value); setEditing(false); } }} dir="auto" style={{ fontSize: 22, fontWeight: 600 }} aria-label="Template name" />
      : <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Escape") { setV(value); setEditing(false); } }} dir="auto" placeholder={placeholder} aria-label="Template description" />;
  }
  const Tag = as;
  return (
    <Tag className={as === "p" ? "sub" : undefined} dir="auto" onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: "text" }}>
      {value || <span className="meta">{placeholder}</span>}
    </Tag>
  );
}
