import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { blockingStepIndex, computeBlocked } from "./blocking.ts";
import type { StepLike } from "./types.ts";

const step = (id: string, marks: string[] = []): StepLike => ({
  id,
  deviceLabel: "Pixel 8",
  kind: "action",
  marks,
});

const steps = [
  step("1", ["t1"]),
  step("2", []),
  step("3", ["t2", "t3"]),
  step("4", ["t4"]),
  step("5", ["t5"]),
];

describe("computeBlocked", () => {
  test("nothing is blocked when no failure blocks", () => {
    const view = computeBlocked(steps, undefined);
    expect(view.blockedFromIndex).toBeUndefined();
    expect(view.blockedStepIds.size).toBe(0);
    expect(view.unverifiedTestIds.size).toBe(0);
  });

  test("the blocking step itself is not blocked — it ran, and it failed", () => {
    const view = computeBlocked(steps, 2);
    expect(view.blockedStepIds.has("3")).toBe(false);
    expect([...view.blockedStepIds]).toEqual(["4", "5"]);
    expect([...view.unverifiedTestIds].sort()).toEqual(["t4", "t5"]);
  });

  test("a block on the last step blocks nothing", () => {
    const view = computeBlocked(steps, steps.length - 1);
    expect(view.blockedStepIds.size).toBe(0);
  });

  test("blocked tests report as unverified, never as failures", () => {
    fc.assert(
      fc.property(fc.nat({ max: steps.length - 1 }), (at) => {
        const view = computeBlocked(steps, at);
        // Every blocked test belongs to a step strictly after the blocking one.
        for (const testId of view.unverifiedTestIds) {
          const owner = steps.findIndex((s) => s.marks.includes(testId));
          expect(owner).toBeGreaterThan(at);
        }
      }),
    );
  });

  test("blocking earlier never blocks fewer steps", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: steps.length - 1 }),
        fc.nat({ max: steps.length - 1 }),
        (a, b) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          expect(computeBlocked(steps, earlier).blockedStepIds.size)
            .toBeGreaterThanOrEqual(computeBlocked(steps, later).blockedStepIds.size);
        },
      ),
    );
  });
});

describe("blockingStepIndex", () => {
  test("nothing blocks when no blocker is marked blocking", () => {
    expect(blockingStepIndex(steps, [{ stepId: "2", blocking: false }])).toBeUndefined();
    expect(blockingStepIndex(steps, [])).toBeUndefined();
  });

  test("the earliest blocker in step order wins, whatever order it was recorded in", () => {
    const blockers = [
      { stepId: "4", blocking: true },
      { stepId: "2", blocking: true },
      { stepId: "1", blocking: false },
    ];
    expect(blockingStepIndex(steps, blockers)).toBe(1);
  });

  test("a blocker on a step not in the flow is ignored", () => {
    expect(blockingStepIndex(steps, [{ stepId: "nope", blocking: true }])).toBeUndefined();
  });
});
