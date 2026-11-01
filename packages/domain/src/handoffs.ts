import type { StepLike } from "./types.ts";

/**
 * Device hand-offs.
 *
 * This is the derived-state bug that is easy to ship
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
  /** Palette slot: template-wide when the caller passes `DeviceSlots`, else by first appearance in this flow. */
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
 * A device label → palette slot map shared by every flow of a template.
 *
 * Slots go by order of first appearance across the template's flows, in flow order.
 * Two things follow. A device has the same colour and letter on the board, the
 * template page, the runner and the editor, so "teal" means the iPhone all day.
 * And two labels never share a slot, because each new label takes the next one —
 * the guarantee that hashing labels could not give.
 *
 * Labels are matched exactly. Near-duplicates ("Pixel 8" / "pixel 8") are the
 * editor's job to prevent (see `matchDeviceLabel`), not this function's to merge.
 */
export type DeviceSlots = ReadonlyMap<string, number>;

export function deviceSlots(flows: readonly { readonly steps: readonly StepLike[] }[]): DeviceSlots {
  const slots = new Map<string, number>();
  for (const flow of flows) {
    for (const step of flow.steps) {
      if (!slots.has(step.deviceLabel)) slots.set(step.deviceLabel, slots.size);
    }
  }
  return slots;
}

/**
 * The flow's devices, banners and colours.
 *
 * Given the template's `slots`, each device keeps its template-wide slot and
 * letter, so a flow that only uses the Pixel and the second laptop shows A and C.
 * A label the template does not know yet — typed into the editor a moment ago —
 * takes the next free slot after every known one. Without `slots`, the flow is its
 * own template: devices are lettered A, B, C by first appearance.
 */
export function computeHandoffs(steps: readonly StepLike[], slots?: DeviceSlots): Handoffs {
  const devices: DeviceAssignment[] = [];
  const byLabel = new Map<string, DeviceAssignment>();
  const introductions = new Map<string, DeviceAssignment>();
  let next = slots ? Math.max(-1, ...slots.values()) + 1 : 0;

  for (const [index, step] of steps.entries()) {
    const label = step.deviceLabel;
    if (byLabel.has(label)) continue;

    const slot = slots?.get(label) ?? next++;
    const assignment: DeviceAssignment = {
      label,
      slot,
      letter: slotLetter(slot),
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
 * Words that put a step on several devices at once without naming them: "compare
 * on both screens", "check every device". Caught alongside named devices, because
 * this is how the two-device check is usually written.
 */
const SEVERAL_DEVICES = /\b(both|all|each|every|either)\s+(of\s+the\s+)?(screens?|devices?|phones?|handsets?|laptops?|sides)\b/i;

export function namesSeveralDevices(text: string): string | undefined {
  return SEVERAL_DEVICES.exec(text)?.[0];
}

/**
 * The existing label a typed one most likely means: the same words, ignoring case
 * and spacing. A step's device is free text, so "Pixel  8" would otherwise
 * be a new device with its own colour and its own hand-off banner.
 */
export function matchDeviceLabel(typed: string, known: Iterable<string>): string | undefined {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const want = norm(typed);
  for (const label of known) if (norm(label) === want) return label;
  return undefined;
}

/**
 * Known device labels a step's text names besides its own — "Check the iPhone and
 * the second laptop" on a step for the iPhone. A step happens on one device,
 * so the editor offers to split it. Whole words, case-insensitive.
 */
export function otherDevicesMentioned(text: string, ownLabel: string, known: Iterable<string>): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const out: string[] = [];
  for (const label of known) {
    if (label === ownLabel) continue;
    const needle = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (needle && hay.includes(` ${needle} `)) out.push(label);
  }
  return out;
}

/**
 * The sticky "in your hands" bar: every device in play
 * at a given point, growing as the flow introduces more. The tester's physical setup
 * and the screen always agree.
 */
export function devicesInPlayAt(
  handoffs: Handoffs,
  stepIndex: number,
): readonly DeviceAssignment[] {
  return handoffs.devices.filter((d) => d.introducedAtIndex <= stepIndex);
}

/** The flow header's up-front device list — the fallback if mid-flow introduction proves disruptive. */
export function devicesUsed(steps: readonly StepLike[]): readonly string[] {
  return computeHandoffs(steps).devices.map((d) => d.label);
}
