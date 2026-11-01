import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { computeHandoffs, deviceSlots, devicesInPlayAt, matchDeviceLabel, namesSeveralDevices, otherDevicesMentioned, slotLetter } from "./handoffs.ts";
import type { StepLike } from "./types.ts";

const step = (id: string, deviceLabel: string): StepLike => ({
  id,
  deviceLabel,
  kind: "action",
  marks: [],
});

/**
 * `.docs/07-open-items.md` names this the derived-state bug that is easy to ship and
 * hard to notice. These are the invariants that make it impossible rather than unlikely.
 */
const arbSteps = fc
  .array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 40 })
  .map((labels) => labels.map((label, i) => step(`s${i}`, label)));

describe("computeHandoffs — invariants", () => {
  test("every step's device is introduced at or before that step", () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        const h = computeHandoffs(steps);
        for (const [index, s] of steps.entries()) {
          const device = h.byLabel.get(s.deviceLabel);
          expect(device).toBeDefined();
          expect(device!.introducedAtIndex).toBeLessThanOrEqual(index);
        }
      }),
    );
  });

  test("holds under any reorder — the bug 07 warns about", () => {
    fc.assert(
      fc.property(arbSteps, fc.array(fc.nat()), (steps, seed) => {
        // Deterministic shuffle driven by the generated seed.
        const shuffled = [...steps];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (seed[i % Math.max(seed.length, 1)] ?? i) % (i + 1);
          const a = shuffled[i]!;
          shuffled[i] = shuffled[j]!;
          shuffled[j] = a;
        }
        const h = computeHandoffs(shuffled);
        for (const [index, s] of shuffled.entries()) {
          expect(h.byLabel.get(s.deviceLabel)!.introducedAtIndex).toBeLessThanOrEqual(index);
        }
      }),
    );
  });

  test("exactly one introduction per distinct device label", () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        const h = computeHandoffs(steps);
        const distinct = new Set(steps.map((s) => s.deviceLabel));
        expect(h.devices.length).toBe(distinct.size);
        expect(h.introductions.size).toBe(distinct.size);
      }),
    );
  });

  test("no two devices in one flow share a palette slot", () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        const h = computeHandoffs(steps);
        expect(new Set(h.devices.map((d) => d.slot)).size).toBe(h.devices.length);
        expect(new Set(h.devices.map((d) => d.letter)).size).toBe(h.devices.length);
      }),
    );
  });

  test("recomputing after an insert equals recomputing from scratch", () => {
    fc.assert(
      fc.property(
        arbSteps,
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 4 }),
        (steps, rawAt, label) => {
          const at = steps.length === 0 ? 0 : rawAt % (steps.length + 1);
          const inserted = [
            ...steps.slice(0, at),
            step("inserted", label),
            ...steps.slice(at),
          ];
          const incremental = computeHandoffs(inserted);
          const scratch = computeHandoffs([...inserted]);
          expect(incremental.devices).toEqual(scratch.devices);
        },
      ),
    );
  });

  test("devices in play only ever grows as the flow advances", () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        const h = computeHandoffs(steps);
        let previous = 0;
        for (let i = 0; i < steps.length; i++) {
          const inPlay = devicesInPlayAt(h, i).length;
          expect(inPlay).toBeGreaterThanOrEqual(previous);
          expect(inPlay).toBeGreaterThanOrEqual(1);
          previous = inPlay;
        }
      }),
    );
  });
});

describe("computeHandoffs — worked example", () => {
  const steps = [
    step("1", "Pixel 8"),
    step("2", "Pixel 8"),
    step("3", "iPhone 13"), // hand-off happens here
    step("4", "Pixel 8"),
    step("5", "iPhone 13"),
  ];

  test("banners land on first use only", () => {
    const h = computeHandoffs(steps);
    expect([...h.introductions.keys()]).toEqual(["1", "3"]);
    expect(h.devices.map((d) => `${d.letter} ${d.label}`)).toEqual([
      "A Pixel 8",
      "B iPhone 13",
    ]);
  });

  test("moving a step above its own introduction moves the banner with it", () => {
    // Step 5 (iPhone) is dragged to the very top, above step 3 which used to introduce it.
    const moved = [steps[4]!, steps[0]!, steps[1]!, steps[2]!, steps[3]!];
    const h = computeHandoffs(moved);
    expect(h.introductions.get("5")?.label).toBe("iPhone 13");
    expect(h.introductions.has("3")).toBe(false);
    // And the iPhone is now device A, since it appears first.
    expect(h.byLabel.get("iPhone 13")?.letter).toBe("A");
  });

  test("an empty flow has no devices", () => {
    expect(computeHandoffs([]).devices).toEqual([]);
  });
});

describe("slotLetter", () => {
  test("walks the alphabet then wraps with a cycle number", () => {
    expect(slotLetter(0)).toBe("A");
    expect(slotLetter(25)).toBe("Z");
    expect(slotLetter(26)).toBe("A2");
    expect(slotLetter(51)).toBe("Z2");
    expect(slotLetter(52)).toBe("A3");
  });
});

describe("template-wide device slots (D41)", () => {
  const flowA = [step("a1", "Pixel 8"), step("a2", "iPhone 13"), step("a3", "Second laptop")];
  const flowB = [step("b1", "Pixel 8"), step("b2", "Second laptop")];

  test("a device keeps its slot and letter in every flow of the template", () => {
    const slots = deviceSlots([{ steps: flowA }, { steps: flowB }]);
    const laptopA = computeHandoffs(flowA, slots).byLabel.get("Second laptop")!;
    const laptopB = computeHandoffs(flowB, slots).byLabel.get("Second laptop")!;
    expect(laptopB.slot).toBe(laptopA.slot);
    expect(laptopB.letter).toBe("C");
  });

  test("no two labels in a template share a slot", () => {
    fc.assert(
      fc.property(fc.array(arbSteps, { maxLength: 6 }), (flows) => {
        const slots = deviceSlots(flows.map((steps) => ({ steps })));
        expect(new Set(slots.values()).size).toBe(slots.size);
        for (const steps of flows) {
          const h = computeHandoffs(steps, slots);
          expect(new Set(h.devices.map((d) => d.slot)).size).toBe(h.devices.length);
        }
      }),
    );
  });

  test("a label the template does not know yet takes the next free slot", () => {
    const slots = deviceSlots([{ steps: flowA }]);
    const h = computeHandoffs([step("n1", "Tablet"), step("n2", "Pixel 8")], slots);
    expect(h.byLabel.get("Tablet")!.slot).toBe(3);
    expect(h.byLabel.get("Pixel 8")!.slot).toBe(0);
  });

  test("without slots, a flow letters its own devices A, B, C", () => {
    expect(computeHandoffs(flowB).devices.map((d) => d.letter)).toEqual(["A", "B"]);
  });
});

describe("device label hygiene", () => {
  test("matches a typed label to a known one, ignoring case and spacing", () => {
    expect(matchDeviceLabel("  pixel   8 ", ["Pixel 8", "iPhone 13"])).toBe("Pixel 8");
    expect(matchDeviceLabel("Pixel 9", ["Pixel 8"])).toBeUndefined();
  });

  test("finds other known devices a step's text names, by whole words", () => {
    const known = ["Pixel 8", "iPhone 13", "Second laptop"];
    expect(otherDevicesMentioned("Check the iPhone 13 and the second laptop.", "iPhone 13", known)).toEqual(["Second laptop"]);
    expect(otherDevicesMentioned("Watch the Pixel 80 boot", "iPhone 13", known)).toEqual([]);
  });

  test("notices a step written for several devices without naming them", () => {
    expect(namesSeveralDevices("Compare the reaction on both screens.")).toBe("both screens");
    expect(namesSeveralDevices("Check each of the devices")).toBe("each of the devices");
    expect(namesSeveralDevices("Both messages arrive")).toBeUndefined();
  });
});
