/**
 * The flow editor.
 *
 * The same visual language as the runner — device colours, action/check
 * markers, attached test rows — so authors see what testers will see. Steps and
 * marks are live: another author's edits arrive as they happen, and hand-off
 * banners are recomputed from order after every insert and drag (the
 * derived-state trap).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeHandoffs, matchDeviceLabel, namesSeveralDevices, otherDevicesMentioned, type DeviceAssignment, type StepKind } from "@flowdeck/domain";
import { api, unwrap, type SnapshotStep, type Test } from "../lib/api.ts";
import { ORDER } from "../lib/collections.ts";
import { useEditorSteps, useLiveCoverage, useTestIndex } from "../lib/editor-model.ts";
import { useMe } from "../lib/identity.tsx";
import { usePeers, usePresence } from "../lib/presence.ts";
import { useTitle } from "../lib/title.ts";
import { DeviceChip, Pickup, deviceStyle, templateSlots } from "../components/Device.tsx";
import { StepMap } from "../components/StepMap.tsx";
import { KindBadge, PostState, TestsIcon } from "../components/Step.tsx";
import { TestPicker } from "../components/TestPicker.tsx";

type Draft = { kind: StepKind; text: string; expectedResult: string; postState: string; deviceLabel: string };

export function FlowEditor() {
  const { productId, templateId, flowId } = useParams({ strict: false }) as { productId: string; templateId: string; flowId: string };
  const qc = useQueryClient();
  const me = useMe();
  const template = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => unwrap(api.GET("/templates/{templateId}", { params: { path: { templateId } } })),
  });
  const flow = template.data?.flows.find((f) => f.id === flowId);
  const { steps, ready, collection, marks } = useEditorSteps(flowId);
  const { tests, byId } = useTestIndex(productId);
  const coverage = useLiveCoverage(productId);

  usePresence(`flow:${flowId}`);
  const others = usePeers(`flow:${flowId}`).filter((a) => a !== me.name);

  useTitle(flow ? `Editing ${flow.name} — Flowdeck` : "Flowdeck");

  // Colours and letters across the whole template, with this flow's live steps
  // standing in for its saved ones so a device typed a moment ago is placed right.
  const slots = useMemo(
    () => templateSlots((template.data?.flows ?? []).map((f) => (f.id === flowId ? { ...f, steps } : f))),
    [template.data, flowId, steps],
  );
  const handoffs = useMemo(() => computeHandoffs(steps, slots), [steps, slots]);
  const knownLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const f of template.data?.flows ?? []) for (const s of f.steps) labels.add(s.deviceLabel);
    for (const s of steps) labels.add(s.deviceLabel);
    return [...labels].sort();
  }, [template.data, steps]);

  const [current, setCurrent] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ index: number; kind: StepKind; device?: string } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const stepRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const scrollTo = useCallback((i: number) => {
    setCurrent(i);
    const s = steps[i];
    if (s) stepRefs.current.get(s.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [steps]);

  /* ── Writes: every one optimistic, every one one transaction ─────────── */

  function reorder(from: number, to: number) {
    if (from === to) return;
    const ids = arrayMove(steps.map((s) => s.id), from, to);
    const changed = ids.filter((id, i) => steps[i]?.id !== id);
    collection.update(changed, { metadata: { [ORDER]: ids } }, (drafts) => {
      for (const d of drafts) d.position = ids.indexOf(d.id);
    });
    setCurrent(to);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorder(steps.findIndex((s) => s.id === active.id), steps.findIndex((s) => s.id === over.id));
  }

  function insert(index: number, d: Draft) {
    const previous = steps[index - 1];
    collection.insert(
      {
        id: `optimistic:${crypto.randomUUID()}`,
        flow_id: flowId,
        // Half a slot above the step it displaces; sorts right until the stream confirms.
        position: index - 0.5,
        kind: d.kind,
        text: d.text,
        expected_result: d.kind === "assertion" ? d.expectedResult || null : null,
        post_state: d.postState || null,
        device_label: d.deviceLabel || previous?.deviceLabel || "Device",
        updated_at: new Date().toISOString(),
      },
      { metadata: { marks: [] } },
    );
    setDraft(null);
    setCurrent(index);
  }

  /** A step names a second device: save it, and open a new step on that device right after. */
  function saveAndSplit(step: SnapshotStep, d: Draft, device: string) {
    save(step, d);
    setDraft({ index: steps.indexOf(step) + 1, kind: d.kind, device });
  }

  function save(step: SnapshotStep, d: Draft) {
    collection.update(step.id, (row) => {
      if (row.kind !== d.kind) row.kind = d.kind;
      if (row.text !== d.text) row.text = d.text;
      const expected = d.kind === "assertion" ? d.expectedResult || null : null;
      if (row.expected_result !== expected) row.expected_result = expected;
      const after = d.postState || null;
      if (row.post_state !== after) row.post_state = after;
      if (row.device_label !== d.deviceLabel) row.device_label = d.deviceLabel;
    });
    setEditing(null);
  }

  function remove(step: SnapshotStep) {
    const n = step.marks.length;
    if (!confirm(`Delete step ${steps.indexOf(step) + 1}?${n ? ` It marks ${n} test${n === 1 ? "" : "s"}; those marks go with it.` : ""}`)) return;
    collection.delete(step.id);
    setEditing(null);
  }

  function toggleMark(stepId: string, testId: string, on: boolean) {
    const key = `${stepId}|${testId}`;
    if (on && !marks.has(key)) marks.insert({ step_id: stepId, test_id: testId });
    if (!on && marks.has(key)) marks.delete(key);
  }

  async function saveFlow(patch: { name?: string; precondition?: string; estimatedMinutes?: number | null; archived?: boolean }) {
    await unwrap(api.PATCH("/flows/{flowId}", { params: { path: { flowId } }, body: patch }));
    await qc.invalidateQueries({ queryKey: ["template", templateId] });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Escape closes whatever is open; nothing else is keyboard-bound here — authors type.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setEditing(null); setDraft(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (template.isPending || !ready) return <main className="shell"><p className="meta">Loading the flow…</p></main>;
  if (!template.data || !flow) return <main className="shell"><p className="note">This flow does not exist.</p></main>;

  const markedTests = new Set(steps.flatMap((s) => s.marks));
  const ids = steps.map((s) => s.id);

  return (
    <main className="shell wide">
      <p className="crumb">
        <Link to="/products/$productId/templates" params={{ productId }} className="lnk">Templates</Link> ›{" "}
        <Link to="/products/$productId/templates/$templateId" params={{ productId, templateId }} className="lnk" dir="auto">{template.data.name}</Link> ›{" "}
        <span dir="auto">{flow.name}</span>
      </p>

      <FlowHead
        flow={flow}
        stepCount={steps.length}
        markedCount={markedTests.size}
        devices={handoffs.devices}
        others={others}
        onSave={saveFlow}
      />

      <div className="grid gap-6 grid-cols-1 md:grid-cols-[minmax(0,1fr)_272px]">
        <div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ol className="steps">
                {steps.map((step, i) => {
                  const intro = handoffs.introductions.get(step.id);
                  const device = handoffs.byLabel.get(step.deviceLabel)!;
                  return (
                    <SortableStep
                      key={step.id}
                      id={step.id}
                      refCb={(el) => { if (el) stepRefs.current.set(step.id, el); else stepRefs.current.delete(step.id); }}
                      style={deviceStyle(device.slot)}
                    >
                      {draft?.index === i ? (
                        <DraftCard
                          kind={draft.kind}
                          index={i}
                          initialDevice={draft.device ?? steps[i - 1]?.deviceLabel ?? knownLabels[0] ?? ""}
                          labels={knownLabels}
                          onSave={(d) => insert(i, d)}
                          onCancel={() => setDraft(null)}
                        />
                      ) : (
                        <Between onAdd={(kind) => { setEditing(null); setDraft({ index: i, kind }); }} />
                      )}
                      {intro && i > 0 ? <Pickup device={intro} /> : null}
                      {intro && i === 0 ? <div className="hand">Start on <DeviceChip device={intro} /></div> : null}
                      {editing === step.id ? (
                        <EditCard
                          step={step}
                          index={i}
                          device={device}
                          labels={knownLabels}
                          onSave={(d) => save(step, d)}
                          onSplit={(d, device) => saveAndSplit(step, d, device)}
                          onCancel={() => setEditing(null)}
                          onDelete={() => remove(step)}
                          onMove={{ up: i > 0 ? () => reorder(i, i - 1) : null, down: i < steps.length - 1 ? () => reorder(i, i + 1) : null }}
                        />
                      ) : (
                        <StepView
                          step={step}
                          index={i}
                          device={device}
                          isCurrent={i === current}
                          byId={byId}
                          productId={productId}
                          multiDevice={multiDeviceWarning(`${step.text} ${step.expectedResult ?? ""}`, step.deviceLabel, knownLabels)}
                          onFocus={() => setCurrent(i)}
                          onEdit={() => { setDraft(null); setEditing(step.id); setCurrent(i); }}
                          onUnmark={(testId) => toggleMark(step.id, testId, false)}
                          onPick={() => setPicking(step.id)}
                        />
                      )}
                    </SortableStep>
                  );
                })}
              </ol>
            </SortableContext>
          </DndContext>

          {draft?.index === steps.length ? (
            <DraftCard
              kind={draft.kind}
              index={steps.length}
              initialDevice={draft.device ?? steps[steps.length - 1]?.deviceLabel ?? knownLabels[0] ?? ""}
              labels={knownLabels}
              onSave={(d) => insert(steps.length, d)}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <div className="flex gap-2 mt-3">
              <button className="btn" onClick={() => { setEditing(null); setDraft({ index: steps.length, kind: "action" }); }}>＋ Add action</button>
              <button className="btn" onClick={() => { setEditing(null); setDraft({ index: steps.length, kind: "assertion" }); }}>＋ Add check</button>
            </div>
          )}
          {!steps.length && !draft ? (
            <p className="meta" style={{ marginTop: 12 }}>
              No steps yet. Start with what the tester does first — "Open the app on the Pixel" — and add checks where something must be true.
            </p>
          ) : null}
          <p className="meta" style={{ marginTop: 26 }}>
            A test can be marked in more than one flow. When that happens, the worst result of the day wins on the dashboard.
          </p>
        </div>

        <aside className="hidden md:block">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <StepMap steps={steps} handoffs={handoffs} current={current} onJump={scrollTo} sortable />
            </SortableContext>
          </DndContext>
        </aside>
      </div>

      <TestPicker
        open={picking !== null}
        tests={tests}
        marked={new Set(picking ? steps.find((s) => s.id === picking)?.marks ?? [] : [])}
        markCount={coverage.markCount}
        onToggle={(testId, on) => picking && toggleMark(picking, testId, on)}
        onClose={() => setPicking(null)}
      />
    </main>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

/** The badge on a saved step that reads as happening on more than one device, or null. */
function multiDeviceWarning(text: string, own: string, labels: string[]): string | null {
  const others = otherDevicesMentioned(text, own, labels);
  if (others.length) return `Also names ${others.join(", ")}`;
  const several = namesSeveralDevices(text);
  return several ? `Says “${several}”` : null;
}

function SortableStep({ id, refCb, style, children }: { id: string; refCb: (el: HTMLLIElement | null) => void; style: React.CSSProperties; children: React.ReactNode }) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={(el) => { setNodeRef(el); refCb(el); }}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "dragging" : undefined}
    >
      {children}
    </li>
  );
}

/** The affordance on the boundary between two steps. */
function Between({ onAdd }: { onAdd: (kind: StepKind) => void }) {
  const [open, setOpen] = useState(false);
  // Once opened it stays until a click lands anywhere outside it, or Escape.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className={`between${open ? " open" : ""}`}>
      {open ? (
        <div className="menu">
          <button className="btn sm" onClick={() => { setOpen(false); onAdd("action"); }}>Action</button>
          <button className="btn sm" onClick={() => { setOpen(false); onAdd("assertion"); }}>Check</button>
          <button className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn sm" onClick={() => setOpen(true)} aria-label="Insert a step here">＋ Insert here</button>
      )}
    </div>
  );
}

function StepView({
  step, index, device, isCurrent, byId, productId, multiDevice, onFocus, onEdit, onUnmark, onPick,
}: {
  step: SnapshotStep; index: number; device: DeviceAssignment; isCurrent: boolean; productId: string;
  byId: Map<string, Test>; multiDevice: string | null;
  onFocus: () => void; onEdit: () => void; onUnmark: (testId: string) => void; onPick: () => void;
}) {
  const isCheck = step.kind === "assertion";
  // An action that verifies nothing is normal; a check that verifies nothing is worth a box saying so.
  const quietMarks = !isCheck && !step.marks.length;
  return (
    <div className={`step${isCurrent ? " now" : ""}`} id={`step-${step.id}`} onClick={onFocus} aria-current={isCurrent ? "step" : undefined}>
      <div className="sline">
        <span className="snum">{index + 1}</span>
        <DeviceChip device={device} />
        <KindBadge kind={step.kind} />
        {multiDevice ? (
          <span className="tag warn" title="A step happens on one device. Edit it to split it.">{multiDevice}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {quietMarks ? <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); onPick(); }}>＋ Mark a test</button> : null}
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</button>
      </div>
      <div className="stop">
        <p className="stext" dir="auto">{step.text}</p>
      </div>
      {isCheck && step.expectedResult ? <div className="expect" dir="auto"><b>Expected:</b> {step.expectedResult}</div> : null}
      <PostState text={step.postState} />
      {quietMarks ? null : <div className={`tests${step.marks.length ? "" : " none"}`}>
        <div className="cap"><TestsIcon />{step.marks.length ? `Verifies ${step.marks.length === 1 ? "1 test" : `${step.marks.length} tests`}` : "This check verifies no test yet"}</div>
        {step.marks.map((testId) => {
          const t = byId.get(testId);
          return (
            <div className="trow" key={testId}>
              <span className="tname" dir="auto">
                {t ? (
                  <Link className="tlink" to="/products/$productId/tests" params={{ productId }} search={{ test: testId }} onClick={(e) => e.stopPropagation()} title="Open in the test library">
                    {t.current.title}
                  </Link>
                ) : <i className="meta">unknown test</i>}
                {t?.archived ? <span className="tag" style={{ marginLeft: 6 }}>archived</span> : null}
              </span>
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); onUnmark(testId); }}>Unmark</button>
            </div>
          );
        })}
        <button className={`btn sm${step.marks.length ? "" : " soft"}`} style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); onPick(); }}>＋ Mark a test</button>
      </div>}
    </div>
  );
}

function StepForm({
  initial, index, labels, submitLabel, onSave, onSplit, onCancel, onDelete, onMove,
}: {
  initial: Draft; index: number; labels: string[]; submitLabel: string;
  onSave: (d: Draft) => void; onCancel: () => void; onDelete?: () => void;
  /** Save, then start a new step on `device` straight after this one. */
  onSplit?: (d: Draft, device: string) => void;
  /** Pointer-free reorder (WCAG 2.2 dragging movements): drag is never the only way. */
  onMove?: { up: (() => void) | null; down: (() => void) | null };
}) {
  const [d, setD] = useState<Draft>(initial);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textRef.current?.focus(); }, []);
  const isCheck = d.kind === "assertion";
  const canSave = d.text.trim().length > 0 && d.deviceLabel.trim().length > 0;
  // Free-text devices, minus the accidents: "pixel  8" is the Pixel 8 the
  // template already has, not a new device with its own colour and banner.
  const known = matchDeviceLabel(d.deviceLabel, labels);
  const device = known ?? d.deviceLabel.trim();
  const isNew = !known && device.length > 0 && labels.length > 0;
  const said = `${d.text} ${isCheck ? d.expectedResult : ""}`;
  const mentions = otherDevicesMentioned(said, device, labels);
  const several = namesSeveralDevices(said);
  // Where the rest of the step could go: the devices it names, else every other one the template knows.
  const splitTo = mentions.length ? mentions : several ? labels.filter((l) => l !== device).slice(0, 3) : [];
  const clean = (): Draft => ({ ...d, text: d.text.trim(), deviceLabel: device, expectedResult: d.expectedResult.trim(), postState: d.postState.trim() });
  const submit = () => canSave && onSave(clean());
  return (
    <div className="step now editform" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}>
      <div className="row">
        <span className="snum">{index + 1}</span>
        <span className="kindpick" role="radiogroup" aria-label="Step kind">
          <button type="button" className={d.kind === "action" ? "on" : ""} onClick={() => setD({ ...d, kind: "action" })}>Action</button>
          <button type="button" className={isCheck ? "on" : ""} onClick={() => setD({ ...d, kind: "assertion" })}>Check</button>
        </span>
        <input className="devin" type="text" list="device-labels" value={d.deviceLabel} onChange={(e) => setD({ ...d, deviceLabel: e.target.value })} placeholder="Device (e.g. Pixel 8)" dir="auto" aria-label="Device label" />
        <datalist id="device-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
        {known && known !== d.deviceLabel.trim() ? <span className="meta devhint">Saves as <b dir="auto">{known}</b></span> : null}
        {isNew ? <span className="meta devhint">New device: it gets its own colour and a hand-off banner</span> : null}
      </div>
      <textarea ref={textRef} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} dir="auto" placeholder={isCheck ? "Compare the reaction on both screens." : 'Long-press "ping 1" and add a 👍 reaction.'} aria-label="Step text" />
      {isCheck ? (
        <div className="afterfield">
          <label htmlFor={`expected-${index}`}>Expected</label>
          <textarea id={`expected-${index}`} value={d.expectedResult} onChange={(e) => setD({ ...d, expectedResult: e.target.value })} dir="auto" placeholder="The reaction shows on this screen with the right count." />
        </div>
      ) : null}
      {splitTo.length || several ? (
        <div className="note min splitnote" role="note">
          <b>{mentions.length ? `This step also names ${mentions.join(" and ")}.` : `This step says “${several}”.`}</b>{" "}
          A step happens on one device, so the tester always knows which screen to look at.
          Keep this one on <b dir="auto">{device || "its device"}</b> and put the rest in a step of its own.
          {onSplit && canSave && splitTo.length ? (
            <span className="splitbtns">
              {splitTo.map((m) => (
                <button key={m} type="button" className="btn sm" onClick={() => onSplit(clean(), m)}>Save and add a step on <span dir="auto">{m}</span></button>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="afterfield">
        <label htmlFor={`after-${index}`}>Afterwards <span className="meta">optional — where the tester should be once this is done. It is what they improvise toward if the step goes stale.</span></label>
        <textarea id={`after-${index}`} className="afterin" value={d.postState} onChange={(e) => setD({ ...d, postState: e.target.value })} dir="auto" placeholder="Back on the channel list, the new message at the bottom." />
      </div>
      <div className="row">
        <button className="btn primary sm" disabled={!canSave} onClick={submit}>{submitLabel}</button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        <span className="meta" style={{ fontSize: 12 }}><span className="kbd">⌘↵</span> save · <span className="kbd">esc</span> cancel</span>
        <span style={{ flex: 1 }} />
        {onMove ? (
          <>
            <button className="btn sm" disabled={!onMove.up} onClick={onMove.up ?? undefined} aria-label="Move step up">↑ Move up</button>
            <button className="btn sm" disabled={!onMove.down} onClick={onMove.down ?? undefined} aria-label="Move step down">↓ Move down</button>
          </>
        ) : null}
        {onDelete ? <button className="btn sm danger" onClick={onDelete}>Delete step</button> : null}
      </div>
    </div>
  );
}

function DraftCard({ kind, index, initialDevice, labels, onSave, onCancel }: { kind: StepKind; index: number; initialDevice: string; labels: string[]; onSave: (d: Draft) => void; onCancel: () => void }) {
  return <StepForm initial={{ kind, text: "", expectedResult: "", postState: "", deviceLabel: initialDevice }} index={index} labels={labels} submitLabel="Add step" onSave={onSave} onCancel={onCancel} />;
}

function EditCard({ step, index, device, labels, onSave, onSplit, onCancel, onDelete, onMove }: { step: SnapshotStep; index: number; device: DeviceAssignment; labels: string[]; onSave: (d: Draft) => void; onSplit: (d: Draft, device: string) => void; onCancel: () => void; onDelete: () => void; onMove: { up: (() => void) | null; down: (() => void) | null } }) {
  return (
    <div style={deviceStyle(device.slot)}>
      <StepForm
        initial={{ kind: step.kind, text: step.text, expectedResult: step.expectedResult ?? "", postState: step.postState ?? "", deviceLabel: step.deviceLabel }}
        index={index} labels={labels} submitLabel="Save" onSave={onSave} onSplit={onSplit} onCancel={onCancel} onDelete={onDelete} onMove={onMove}
      />
    </div>
  );
}

function FlowHead({
  flow, stepCount, markedCount, devices, others, onSave,
}: {
  flow: { name: string; precondition: string; estimatedMinutes: number | null; archived: boolean };
  stepCount: number; markedCount: number; devices: readonly DeviceAssignment[]; others: string[];
  onSave: (patch: { name?: string; precondition?: string; estimatedMinutes?: number | null; archived?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(flow.name);
  const [pre, setPre] = useState(flow.precondition);
  const [mins, setMins] = useState(flow.estimatedMinutes?.toString() ?? "");
  useEffect(() => { setName(flow.name); setPre(flow.precondition); setMins(flow.estimatedMinutes?.toString() ?? ""); }, [flow]);

  const commit = () => {
    const patch: { name?: string; precondition?: string; estimatedMinutes?: number | null } = {};
    if (name.trim() && name.trim() !== flow.name) patch.name = name.trim();
    if (pre !== flow.precondition) patch.precondition = pre;
    const m = mins.trim() ? Number(mins) : null;
    if ((Number.isInteger(m) && m! > 0 ? m : null) !== flow.estimatedMinutes) patch.estimatedMinutes = Number.isInteger(m) && m! > 0 ? m : null;
    if (Object.keys(patch).length) void onSave(patch);
  };

  return (
    <div className="flowhead">
      {flow.archived ? (
        <div className="note skp" style={{ marginLeft: 0, marginBottom: 12 }}>
          <b>Archived.</b> New testing days leave this flow out; its marks still count toward coverage and past days keep their results.
          <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => void onSave({ archived: false })}>Restore</button>
        </div>
      ) : null}
      <div className="row-split">
        <div style={{ flex: 1, minWidth: 240 }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} dir="auto" aria-label="Flow name" style={{ fontWeight: 600, fontSize: 16 }} />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="meta">~</span>
          <input className="mins" type="text" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} onBlur={commit} placeholder="min" aria-label="Estimated minutes" style={{ width: 70 }} />
          <span className="meta">min · {stepCount} steps · marks {markedCount} tests</span>
          {!flow.archived ? <button className="btn sm" onClick={() => void onSave({ archived: true })}>Archive flow</button> : null}
        </div>
      </div>
      <label className="f" htmlFor="flow-pre">Before you start</label>
      <textarea id="flow-pre" value={pre} onChange={(e) => setPre(e.target.value)} onBlur={commit} dir="auto" placeholder="The state the product must be in before step 1. 'Relay uninstalled from the Pixel. You have valid credentials for the QA workspace.'" style={{ minHeight: 56 }} />
      <div className="flex gap-2 items-center flex-wrap mt-3">
        <span className="meta">Devices used:</span>
        {devices.map((d) => <DeviceChip key={d.label} device={d} />)}
        <span className="meta">— each appears at the step that first needs it</span>
        <span style={{ flex: 1 }} />
        {others.length ? (
          <span className="who" title="Also editing this flow">
            <span className="meta">Also here:</span>
            {others.map((a) => <span key={a} className="tag" dir="auto">{a}</span>)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
