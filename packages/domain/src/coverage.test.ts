import { describe, expect, test } from "bun:test";
import { coverageOf, summarizeCoverage } from "./coverage.ts";

describe("coverage", () => {
  test("a test marked anywhere is covered", () => {
    const state = coverageOf({
      testId: "t1",
      archived: false,
      markedByTemplateIds: ["tpl-legacy"],
    });
    expect(state.covered).toBe(true);
    expect(state.needsAttention).toBe(false);
  });

  test("an archived template still covers — coverage asks 'reachable', not 'recent'", () => {
    // The caller passes archived templates in; there is no filtering here by design.
    expect(
      coverageOf({ testId: "t1", archived: false, markedByTemplateIds: ["archived-tpl"] })
        .covered,
    ).toBe(true);
  });

  test("a live test marked by nothing is the error state", () => {
    const state = coverageOf({ testId: "t1", archived: false, markedByTemplateIds: [] });
    expect(state.covered).toBe(false);
    expect(state.needsAttention).toBe(true);
  });

  test("an archived test stops counting, and stops warning", () => {
    const state = coverageOf({ testId: "t1", archived: true, markedByTemplateIds: [] });
    expect(state.covered).toBe(false);
    expect(state.needsAttention).toBe(false);
  });

  test("the 'covers 20 of 25' line excludes archived tests from both halves", () => {
    const summary = summarizeCoverage([
      { testId: "a", archived: false, markedByTemplateIds: ["t"] },
      { testId: "b", archived: false, markedByTemplateIds: ["t", "u"] },
      { testId: "c", archived: false, markedByTemplateIds: [] },
      { testId: "d", archived: true, markedByTemplateIds: [] },
    ]);
    expect(summary).toEqual({ total: 3, covered: 2, uncovered: 1 });
  });
});
