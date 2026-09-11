/**
 * The titles-only step map (improvement I3, and `07-open-items.md`'s sidebar).
 * A fifty-step flow does not fit on one screen; this does. Click to jump.
 */
import type { Handoffs } from "@flowdeck/domain";
import type { SnapshotStep } from "../lib/api.ts";
import type { flowRunView } from "../lib/run-model.ts";
import { deviceStyle } from "./Device.tsx";

export function StepMap({
  steps, handoffs, current, view, onJump,
}: {
  steps: SnapshotStep[];
  handoffs: Handoffs;
  current: number;
  view: ReturnType<typeof flowRunView>;
  onJump: (i: number) => void;
}) {
  return (
    <nav className="stepmap" aria-label="Steps">
      {steps.map((s, i) => {
        const device = handoffs.byLabel.get(s.deviceLabel)!;
        const done = s.marks.length > 0 && s.marks.every((t) => view.byStepTest.has(`${s.id}|${t}`));
        return (
          <a
            key={s.id}
            href={`#step-${s.id}`}
            className={`${i === current ? "now" : ""} ${done ? "done" : ""}`}
            style={deviceStyle(device.slot)}
            onClick={(e) => { e.preventDefault(); onJump(i); }}
          >
            <span className="n">{i + 1}</span>
            <span className="t" dir="auto">{s.text}</span>
          </a>
        );
      })}
    </nav>
  );
}
