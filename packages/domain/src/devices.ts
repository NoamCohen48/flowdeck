/**
 * The device palette (improvement I4).
 *
 * `.docs/05-design-and-ux.md` defines exactly four device colours, but device labels
 * are free text and unbounded (D16) — a flow using five devices had no defined
 * behaviour. The first four slots are the demo's original colours, unchanged.
 *
 * Constraints, all enforced by `devices.test.ts` rather than asserted in prose:
 *  - white text on each swatch reaches WCAG AA (4.5:1);
 *  - every pair of device colours is separated in hue, so the two or three devices a
 *    flow actually uses are never near-identical;
 *  - added slots stay clear of the four result colours, so a device chip is never
 *    mistaken for a verdict.
 *
 * **Seven slots, not eight.** Hue space is more crowded than it looks: red, amber,
 * green and slate-blue are spoken for by fail / minor / pass / skipped, and the four
 * inherited device colours take violet, teal, ochre and magenta. Every remaining
 * candidate for an eighth sat within ~20° of something it would be confused with, so
 * the palette stops at seven rather than shipping a slot that reads as a verdict.
 *
 * **Inherited collisions, flagged not fixed.** The demo's own ochre (`--dev-c`, hue 30)
 * is 8° from the minor amber `#A66A00`, and its magenta (`--dev-d`, hue 332) is 28°
 * from the fail red `#C22F2F`. Matching the demo was the instruction, so these stand —
 * but a device C chip beside a minor-verdict pill is genuinely hard to tell apart, and
 * it is worth a decision. See `docs` note in the implementation plan.
 *
 * Colour is never load-bearing alone: every device is shown as colour + letter + name.
 */
export const DEVICE_PALETTE = [
  "#5B45C7", // A · violet   — the demo's --dev-a   (hue 250)
  "#0C7F80", // B · teal     — the demo's --dev-b   (hue 181)
  "#A85C10", // C · ochre    — the demo's --dev-c   (hue  30)
  "#B23A72", // D · magenta  — the demo's --dev-d   (hue 332)
  // Blue sits only 9° from the skipped grey-blue, so it is separated by lightness
  // instead — dark enough to clear it by contrast. `distinguishable()` encodes that.
  "#15529B", // E · blue                            (hue 213)
  "#8E3BA8", // F · purple                          (hue 286)
  "#4F6B1F", // G · moss                            (hue  82)
] as const;

/** Slots wrap past the palette length; the letter keeps them distinguishable. */
export function deviceColor(slot: number): string {
  const color = DEVICE_PALETTE[slot % DEVICE_PALETTE.length];
  return color ?? DEVICE_PALETTE[0];
}

/** Result-state colours, from `.docs/05-design-and-ux.md`. Skipped is deliberately colourless. */
export const RESULT_COLORS = {
  pass: "#1B7A46",
  fail: "#C22F2F",
  minor: "#A66A00",
  skipped: "#78868F",
} as const;

// --- contrast, exported so the palette can be tested rather than asserted --------

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`not a hex colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees, 0–360. Exported so palette separation is testable, not asserted. */
export function hue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`not a hex colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

/** Shortest angular distance between two hues, 0–180. */
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Two colours are safely distinguishable if they differ enough in hue, or if one is
 * dark enough against the other that lightness alone separates them.
 */
export function distinguishable(a: string, b: string): boolean {
  return hueDistance(a, b) >= 25 || contrastRatio(a, b) >= 1.6;
}
