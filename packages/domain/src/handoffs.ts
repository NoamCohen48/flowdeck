import type { StepLike } from "./types.ts";

/**
 * Device hand-offs.
 *
 * `.docs/07-open-items.md` flags this as the derived-state bug that is easy to ship
 * and hard to notice: a hand-off banner is "the first step using this device label",
 * so every insert and every reorder can move it. Moving a step above the point where
 * its device is introduced must move the banner with it, not orphan the step.
 *
 * The fix is structural rather than careful: the banner is **never stored**. It is a
 * pure function of the ordered step list, recomputed on every render, on both the
 * editor and the runner. There is no stale copy because there is no copy.
 */

export interface DeviceAssignment {
  readonly label: string;
  /** Palette slot, by order of first appearance in this flow. See `devices.ts`. */
  readonly slot: number;
  /** "A", "B", "C"… the abstract handle the docs require alongside colour and name. */
  readonly letter: string;
  readonly introducedAtStepId: string;
  readonly introducedAtIndex: number;
}

export interface Handoffs {
  /** Every device the flow uses, in order of first appearance. */
  readonly devices: readonly DeviceAssignment[];
  readonly byLabel: ReadonlyMap<string, DeviceAssignment>;
  /** Step ID → the device it introduces. Absent for steps that introduce nothing. */
  readonly introductions: ReadonlyMap<string, DeviceAssignment>;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Slot 0 → "A" … slot 25 → "Z", then "A2", "B2", … Unbounded, since labels are free text. */
export function slotLetter(slot: number): string {
  const cycle = Math.floor(slot / LETTERS.length);
  const letter = LETTERS[slot % LETTERS.length] ?? "?";
  return cycle === 0 ? letter : `${letter}${cycle + 1}`;
}

/**
 * Assign devices by **order of first appearance in the flow**, not by hashing the label.
 *
 * Hashing would give a device the same colour across every flow, which is appealing —
 * but two labels in one flow could hash to the same slot, and two adjacent steps in
 * indistinguishable colours is exactly the confusion this whole system exists to remove.
 * Order of appearance cannot collide within a flow, and matches the demo's A/B/C/D.
 * Cross-flow consistency is given up; the device *name* is always shown, so nothing is lost.
 */
export function computeHandoffs(steps: readonly StepLike[]): Handoffs {
  const devices: DeviceAssignment[] = [];
  const byLabel = new Map<string, DeviceAssignment>();
  const introductions = new Map<string, DeviceAssignment>();

  for (const [index, step] of steps.entries()) {
    const label = step.deviceLabel;
    if (byLabel.has(label)) continue;

    const assignment: DeviceAssignment = {
      label,
      slot: devices.length,
      letter: slotLetter(devices.length),
      introducedAtStepId: step.id,
      introducedAtIndex: index,
    };
    devices.push(assignment);
    byLabel.set(label, assignment);
    introductions.set(step.id, assignment);
  }

  return { devices, byLabel, introductions };
}

/**
 * The sticky "in your hands" bar (`.docs/05-design-and-ux.md`): every device in play
 * at a given point, growing as the flow introduces more. The tester's physical setup
 * and the screen always agree.
 */
export function devicesInPlayAt(
  handoffs: Handoffs,
  stepIndex: number,
): readonly DeviceAssignment[] {
  return handoffs.devices.filter((d) => d.introducedAtIndex <= stepIndex);
}

/** The flow header's up-front device list — the agreed fallback position for D17. */
export function devicesUsed(steps: readonly StepLike[]): readonly string[] {
  return computeHandoffs(steps).devices.map((d) => d.label);
}
