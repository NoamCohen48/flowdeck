import { deviceColor, type DeviceAssignment } from "@flowdeck/domain";
import type { CSSProperties } from "react";

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
export function Pickup({ device }: { device: DeviceAssignment }) {
  return (
    <div className="pickup" style={deviceStyle(device.slot)} role="note">
      <span className="big" aria-hidden>
        ⇢
      </span>
      <div>
        <h3>
          Pick up <span dir="auto">{device.label}</span>
        </h3>
        <p>
          Everything in this colour from here on happens on device {device.letter}.
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
