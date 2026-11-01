import { deviceColor, deviceSlots, type DeviceAssignment, type DeviceSlots, type StepLike } from "@flowdeck/domain";
import type { CSSProperties } from "react";

/**
 * A template's device slots as every screen must see them (D41). Active flows
 * first, in order, then archived ones: a testing day's snapshot leaves archived
 * flows out, so this is the only order in which the template page and the
 * editor agree with the board and the runner.
 */
export function templateSlots(flows: readonly { archived?: boolean; steps: readonly StepLike[] }[]): DeviceSlots {
  return deviceSlots([...flows.filter((f) => !f.archived), ...flows.filter((f) => f.archived)]);
}

/** Sets `--dev` for anything inside; steps, chips and banners all read it. */
export function deviceStyle(slot: number): CSSProperties {
  return { "--dev": deviceColor(slot) } as CSSProperties;
}

/**
 * Colour + letter + name, always all three (`.docs/05-design-and-ux.md`).
 * Colour is never load-bearing alone.
 */
export function DeviceChip({ device, ghost = false }: { device: DeviceAssignment; ghost?: boolean }) {
  return (
    <span className={`dev${ghost ? " ghost" : ""}`} style={deviceStyle(device.slot)} dir="auto">
      <i aria-hidden>{device.letter}</i>
      <span className="sr-only">Device {device.letter}, </span>
      {device.label}
    </span>
  );
}

/**
 * The hand-off banner. Deliberately the loudest element in the product: picking up
 * the wrong device is the most confusing failure mode in the old suite (D18).
 */
export function Pickup({ device, muted = false }: { device: DeviceAssignment; muted?: boolean }) {
  // Muted when the steps it introduces are blocked: nobody should pick up a phone for work they cannot do.
  return (
    <div className={`pickup${muted ? " muted" : ""}`} style={deviceStyle(device.slot)} role="note">
      <span className="big" aria-hidden>{device.letter}</span>
      <div>
        <h3>
          Pick up <span dir="auto">{device.label}</span>
        </h3>
        <p>
          Everything in this colour from here on happens on <span dir="auto">{device.label}</span> (device {device.letter}).
        </p>
      </div>
    </div>
  );
}

/** The sticky "in your hands" bar: every device in play so far. */
export function DeviceBar({ devices }: { devices: readonly DeviceAssignment[] }) {
  if (!devices.length) return null;
  return (
    <div className="devbar">
      <span className="lbl">In your hands:</span>
      {devices.map((d) => (
        <DeviceChip key={d.label} device={d} />
      ))}
    </div>
  );
}
