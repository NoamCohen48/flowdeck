/**
 * The step map. A fifty-step
 * flow does not fit on one screen; this does. Click to jump. In the editor it is
 * also sortable: reordering against a map beats dragging through hundreds of
 * pixels of step detail. Drag is never the only way — the edit form has Move up
 * and Move down, and dnd-kit's keyboard sensor works here too.
 */
import type { Handoffs, Verdict } from "@flowdeck/domain";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SnapshotStep } from "../lib/api.ts";
import { deviceStyle } from "./Device.tsx";

/**
 * How a step went, for the runner's map. The worst verdict on it, once it has one;
 * "done" for a step that verifies nothing and is behind the tester; "blocked" and
 * "flag" for what the runner shows on the step card itself.
 */
export type StepStatus = Verdict | "done" | "blocked" | "flag";

const STATUS_LABEL: Record<StepStatus, string> = {
  pass: "passed", fail: "failed", minor: "minor issue", skipped: "skipped", done: "done", blocked: "blocked", flag: "step is wrong",
};
const STATUS_GLYPH: Record<StepStatus, string> = {
  pass: "✓", fail: "✕", minor: "!", skipped: "–", done: "✓", blocked: "⊘", flag: "⚑",
};

export function StepMap({
  steps, handoffs, current, onJump, statusOf, sortable = false, title = "Steps",
}: {
  steps: SnapshotStep[];
  handoffs: Handoffs;
  current: number;
  onJump: (i: number) => void;
  /** The runner's view of each step; the editor has none. */
  statusOf?: (s: SnapshotStep, i: number) => StepStatus | undefined;
  /** Render inside a dnd-kit SortableContext keyed by step id. */
  sortable?: boolean;
  title?: string;
}) {
  const statuses = statusOf ? steps.map(statusOf) : null;
  const done = statuses ? statuses.filter((st) => st && st !== "blocked").length : null;
  const blocked = statuses ? statuses.filter((st) => st === "blocked").length : 0;
  return (
    <nav className={`stepmap${sortable ? " sortable" : ""}`} aria-label="Steps">
      <div className="mh">
        <span>{title} <span className="meta">· {steps.length}</span></span>
        <span className="meta">{done !== null ? `${done} done${blocked ? ` · ${blocked} blocked` : ""}` : sortable ? "drag to reorder" : ""}</span>
      </div>
      <div className="ml">
        {steps.map((s, i) => {
          const device = handoffs.byLabel.get(s.deviceLabel)!;
          const status = statuses?.[i];
          const props = {
            href: `#step-${s.id}`,
            className: `${i === current ? "now" : ""}${status ? ` done st-${status}` : ""}`,
            style: deviceStyle(device.slot),
            onClick: (e: React.MouseEvent) => { e.preventDefault(); onJump(i); },
            title: s.text,
            children: (
              <>
                <span className="n">{i + 1}</span>
                <span className="t" dir="auto">{s.text || <i className="meta">untitled step</i>}</span>
                {status ? <span className="st" title={STATUS_LABEL[status]}><span aria-hidden>{STATUS_GLYPH[status]}</span><span className="sr-only">{STATUS_LABEL[status]}</span></span> : null}
                <span className="s">
                  <span className="d" aria-hidden /> {device.letter} · {s.kind === "assertion" ? "check" : "action"}
                  {s.marks.length ? <span className="m">· {s.marks.length === 1 ? "1 test" : `${s.marks.length} tests`}</span> : null}
                </span>
              </>
            ),
          };
          return sortable ? <SortableRow key={s.id} id={s.id} {...props} /> : <a key={s.id} {...props} />;
        })}
      </div>
    </nav>
  );
}

function SortableRow({ id, style, className, ...rest }: { id: string } & React.ComponentProps<"a">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <a
      ref={setNodeRef}
      {...rest}
      {...attributes}
      {...listeners}
      className={`${className ?? ""}${isDragging ? " dragging" : ""}`}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition, touchAction: "none" }}
    />
  );
}
