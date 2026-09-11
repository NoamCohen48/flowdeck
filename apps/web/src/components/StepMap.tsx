/**
 * The titles-only step map (improvement I3, and `07-open-items.md`'s sidebar).
 * A fifty-step flow does not fit on one screen; this does. Click to jump. In the
 * editor it is also sortable: reordering against a map beats dragging through
 * hundreds of pixels of step detail.
 */
import type { Handoffs } from "@flowdeck/domain";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SnapshotStep } from "../lib/api.ts";
import { deviceStyle } from "./Device.tsx";

export function StepMap({
  steps, handoffs, current, onJump, isDone, sortable = false,
}: {
  steps: SnapshotStep[];
  handoffs: Handoffs;
  current: number;
  onJump: (i: number) => void;
  isDone?: (s: SnapshotStep) => boolean;
  /** Render inside a dnd-kit SortableContext keyed by step id. */
  sortable?: boolean;
}) {
  return (
    <nav className="stepmap" aria-label="Steps">
      {steps.map((s, i) => {
        const device = handoffs.byLabel.get(s.deviceLabel)!;
        const props = {
          href: `#step-${s.id}`,
          className: `${i === current ? "now" : ""} ${isDone?.(s) ? "done" : ""}`,
          style: deviceStyle(device.slot),
          onClick: (e: React.MouseEvent) => { e.preventDefault(); onJump(i); },
          children: (
            <>
              <span className="n">{i + 1}</span>
              <span className="t" dir="auto">{s.text || <i className="meta">untitled step</i>}</span>
            </>
          ),
        };
        return sortable ? <SortableRow key={s.id} id={s.id} {...props} /> : <a key={s.id} {...props} />;
      })}
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
