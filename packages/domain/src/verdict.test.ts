import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  isIssue,
  issueType,
  VERDICT_RANK,
  VERDICTS_WORST_FIRST,
  verdictCountsAsVerified,
  verdictRequiresNote,
  worstResult,
  worstResultByTest,
} from "./verdict.ts";
import type { Verdict } from "./types.ts";

const arbVerdict = fc.constantFrom<Verdict>("pass", "fail", "minor", "skipped");

describe("worstResult", () => {
  test("the documented precedence: fail > skipped > minor > pass", () => {
    expect(VERDICTS_WORST_FIRST).toEqual(["fail", "skipped", "minor", "pass"]);
    expect(worstResult(["pass", "fail"])).toBe("fail");
    expect(worstResult(["pass", "minor"])).toBe("minor");
    expect(worstResult(["minor", "skipped"])).toBe("skipped");
    expect(worstResult(["skipped", "fail"])).toBe("fail");
  });

  test("a fail anywhere is never buried by a pass elsewhere", () => {
    fc.assert(
      fc.property(fc.array(arbVerdict), (verdicts) => {
        const result = worstResult([...verdicts, "fail"]);
        expect(result).toBe("fail");
      }),
    );
  });

  test("order of results never changes the answer", () => {
    fc.assert(
      fc.property(fc.array(arbVerdict, { minLength: 1 }), (verdicts) => {
        expect(worstResult(verdicts)).toBe(worstResult([...verdicts].reverse()));
      }),
    );
  });

  test("the answer is always one of the inputs", () => {
    fc.assert(
      fc.property(fc.array(arbVerdict, { minLength: 1 }), (verdicts) => {
        expect(verdicts).toContain(worstResult(verdicts)!);
      }),
    );
  });

  test("adding a result can only make the day's verdict worse, never better", () => {
    fc.assert(
      fc.property(
        fc.array(arbVerdict, { minLength: 1 }),
        arbVerdict,
        (verdicts, extra) => {
          const before = VERDICT_RANK[worstResult(verdicts)!];
          const after = VERDICT_RANK[worstResult([...verdicts, extra])!];
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });

  test("no results means no verdict — 'not reached' is a first-class outcome", () => {
    expect(worstResult([])).toBeUndefined();
  });
});

describe("worstResultByTest", () => {
  test("collapses per test, independently", () => {
    const collapsed = worstResultByTest([
      { testId: "t1", verdict: "pass" },
      { testId: "t1", verdict: "fail" }, // flow 4 found a bug flow 2 missed
      { testId: "t2", verdict: "pass" },
      { testId: "t3", verdict: "minor" },
      { testId: "t3", verdict: "skipped" },
    ]);
    expect(collapsed.get("t1")).toBe("fail");
    expect(collapsed.get("t2")).toBe("pass");
    expect(collapsed.get("t3")).toBe("skipped");
    expect(collapsed.has("t4")).toBe(false);
  });
});

describe("verdict semantics", () => {
  test("fail and skipped require a note; pass and minor do not", () => {
    expect(verdictRequiresNote("fail")).toBe(true);
    expect(verdictRequiresNote("skipped")).toBe(true);
    expect(verdictRequiresNote("pass")).toBe(false);
    expect(verdictRequiresNote("minor")).toBe(false);
  });

  test("minor counts as verified; skipped does not", () => {
    expect(verdictCountsAsVerified("minor")).toBe(true);
    expect(verdictCountsAsVerified("pass")).toBe(true);
    expect(verdictCountsAsVerified("skipped")).toBe(false);
    expect(verdictCountsAsVerified("fail")).toBe(false);
  });

  test("the issue feed exports everything except pass", () => {
    expect(isIssue("pass")).toBe(false);
    for (const v of ["fail", "minor", "skipped"] as const) {
      expect(isIssue(v)).toBe(true);
    }
    expect(issueType("fail")).toBe("failure");
    expect(issueType("minor")).toBe("minor");
    expect(issueType("skipped")).toBe("invalid_test");
  });
});
