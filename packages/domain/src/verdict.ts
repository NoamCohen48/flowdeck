import type { ResultLike, Verdict } from "./types.ts";

/**
 * Worst result wins. A fail anywhere means the test failed that day —
 * a passing path must never bury a real bug. Skipped outranks minor and pass
 * because a test reported as invalid should not appear green.
 *
 *   fail > skipped > minor > pass
 *
 * The same ordering exists in SQL as `verdict_rank()`; `verdict.sql.test.ts`
 * asserts the two agree.
 */
export const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  fail: 3,
  skipped: 2,
  minor: 1,
  pass: 0,
};

/** Ordered worst-first. Useful for report ordering and for the SQL comparison test. */
export const VERDICTS_WORST_FIRST: readonly Verdict[] = [
  "fail",
  "skipped",
  "minor",
  "pass",
];

/** The single verdict a run reports for a test, given every result recorded for it. */
export function worstResult(verdicts: readonly Verdict[]): Verdict | undefined {
  let worst: Verdict | undefined;
  for (const v of verdicts) {
    if (worst === undefined || VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
  }
  return worst;
}

/** Collapse many results into one verdict per test. Tests with no result are absent. */
export function worstResultByTest(
  results: readonly ResultLike[],
): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  for (const r of results) {
    const current = out.get(r.testId);
    if (current === undefined || VERDICT_RANK[r.verdict] > VERDICT_RANK[current]) {
      out.set(r.testId, r.verdict);
    }
  }
  return out;
}

/**
 * Fail and skipped require a written explanation. Fail because a bug report
 * without a description is not actionable; skipped because it is the only channel
 * through which testers report that the suite itself is wrong.
 */
export function verdictRequiresNote(verdict: Verdict): boolean {
  return verdict === "fail" || verdict === "skipped";
}

/**
 * Minor counts as verified — the test was checked and the answer was
 * "fine, with a caveat". Skipped does not: it is a statement about the test,
 * not about the product.
 */
export function verdictCountsAsVerified(verdict: Verdict): boolean {
  return verdict === "pass" || verdict === "minor";
}

/** Everything the issue feed exports. Pass is the only thing left out. */
export function isIssue(verdict: Verdict): boolean {
  return verdict !== "pass";
}

/** Flowdeck labels, the adapter decides. */
export function issueType(
  verdict: Exclude<Verdict, "pass">,
): "failure" | "minor" | "invalid_test" {
  return verdict === "fail"
    ? "failure"
    : verdict === "minor"
      ? "minor"
      : "invalid_test";
}
