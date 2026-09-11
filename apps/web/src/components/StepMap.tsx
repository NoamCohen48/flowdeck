/**
 * The step map (improvement I3, and `07-open-items.md`'s sidebar). A fifty-step
 * flow does not fit on one screen; this does. Click to jump. In the editor it is
 * also sortable: reordering against a map beats dragging through hundreds of
 * pixels of step detail. Drag is never the only way — the edit form has Move up
 * and Move down, and dnd-kit's keyboard sensor works here too.
 */
import type { Handoffs } from "@flowdeck/domain";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SnapshotStep } from "../lib/api.ts";
import { deviceStyle } from "./Device.tsx";

export function StepMap({
  steps, handoffs, current, onJump, isDone, sortable = false, title = "Steps",
}: {
  steps: SnapshotStep[];
  handoffs: Handoffs;
  current: number;
  onJump: (i: number) => void;
  isDone?: (s: SnapshotStep) => boolean;
  /** Render inside a dnd-kit SortableContext keyed by step id. */
  sortable?: boolean;
  title?: string;
}) {
  const done = isDone ? steps.filter(isDone).length : null;
  return (
    <nav className={`stepmap${sortable ? " sortable" : ""}`} aria-label="Steps">
      <div className="mh">
        <span>{title} <span className="meta">· {steps.length}</span></span>
        <span className="meta">{done !== null ? `${done} done` : sortable ? "drag to reorder" : ""}</span>
      </div>
      <div className="ml">
        {steps.map((s, i) => {
          const device = handoffs.byLabel.get(s.deviceLabel)!;
          const props = {
            href: `#step-${s.id}`,
            className: `${i === current ? "now" : ""} ${isDone?.(s) ? "done" : ""}`,
            style: deviceStyle(device.slot),
            onClick: (e: React.MouseEvent) => { e.preventDefault(); onJump(i); },
            title: s.text,
            children: (
              <>
                <span className="n">{i + 1}</span>
                <span className="t" dir="auto">{s.text || <i className="meta">untitled step</i>}</span>
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
