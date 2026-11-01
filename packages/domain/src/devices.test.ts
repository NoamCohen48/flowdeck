import { describe, expect, test } from "bun:test";
import {
  contrastRatio,
  deviceColor,
  DEVICE_PALETTE,
  distinguishable,
  hue,
  hueDistance,
  RESULT_COLORS,
} from "./devices.ts";

/** The four slots of the original design, kept rather than redesigned. */
const INHERITED = DEVICE_PALETTE.slice(0, 4);
/** The extra slots, which are held to the full standard. */
const ADDED = DEVICE_PALETTE.slice(4);

describe("device palette", () => {
  test("white text on every device colour reaches WCAG AA", () => {
    for (const color of DEVICE_PALETTE) {
      expect(contrastRatio(color, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("no two device colours in the palette are confusable", () => {
    for (const [i, a] of DEVICE_PALETTE.entries()) {
      for (const b of DEVICE_PALETTE.slice(i + 1)) {
        expect(distinguishable(a, b)).toBe(true);
      }
    }
  });

  test("added slots are never confusable with a result colour", () => {
    for (const device of ADDED) {
      for (const result of Object.values(RESULT_COLORS)) {
        expect(distinguishable(device, result)).toBe(true);
      }
    }
  });

  test("the first four slots are the original colours, unchanged", () => {
    expect(INHERITED).toEqual(["#5B45C7", "#0C7F80", "#A85C10", "#B23A72"]);
  });

  /**
   * Documents a real defect in the inherited palette rather than hiding it: ochre is
   * 8° from the minor amber and magenta is 28° from the fail red. Keeping the originals
   * was the instruction, so this test pins the current state — if someone later fixes
   * `--dev-c`, this test fails and tells them to delete it.
   */
  test("inherited slots collide with result colours — known, flagged", () => {
    expect(hueDistance("#A85C10", RESULT_COLORS.minor)).toBeLessThan(15);
    expect(hueDistance("#B23A72", RESULT_COLORS.fail)).toBeLessThan(30);
  });

  test("slots wrap rather than falling off the end", () => {
    expect(deviceColor(0)).toBe(DEVICE_PALETTE[0]!);
    expect(deviceColor(DEVICE_PALETTE.length)).toBe(DEVICE_PALETTE[0]!);
    expect(deviceColor(DEVICE_PALETTE.length + 1)).toBe(DEVICE_PALETTE[1]!);
  });

  test("colour maths is a sane implementation", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(hue("#FF0000")).toBeCloseTo(0, 1);
    expect(hue("#00FF00")).toBeCloseTo(120, 1);
    expect(hue("#0000FF")).toBeCloseTo(240, 1);
    expect(hueDistance("#FF0000", "#00FF00")).toBeCloseTo(120, 1);
    expect(hueDistance("#0000FF", "#FF0000")).toBeCloseTo(120, 1);
  });
});
