/**
 * Coverage (`.docs/04-coverage-and-reporting.md`).
 *
 *   A test is covered if at least one step, in at least one flow, in at least one
 *   template of its product, marks it.
 *
 * Deliberately broad. Archived and never-run templates count (D3), because the
 * question is "is this reachable by some flow somewhere", not "was it executed
 * recently" — recency is a run question with its own reporting.
 *
 * Uncovered is legal (D2). The system warns; it never blocks.
 */

export interface CoverageInput {
  readonly testId: string;
  readonly archived: boolean;
  /** Template IDs whose flows mark this test. Empty means uncovered. */
  readonly markedByTemplateIds: readonly string[];
}

export interface CoverageState {
  readonly testId: string;
  readonly covered: boolean;
  /** True only for a live test nothing marks — the red row and the warning. */
  readonly needsAttention: boolean;
  readonly templateIds: readonly string[];
}

export function coverageOf(input: CoverageInput): CoverageState {
  const covered = input.markedByTemplateIds.length > 0;
  return {
    testId: input.testId,
    covered,
    // An archived test stops counting toward coverage (D7) — flagging it would be noise.
    needsAttention: !covered && !input.archived,
    templateIds: input.markedByTemplateIds,
  };
}

export interface CoverageSummary {
  readonly total: number;
  readonly covered: number;
  readonly uncovered: number;
}

/** The "covers 20 of 25 tests" line. Archived tests are excluded from both halves. */
export function summarizeCoverage(
  inputs: readonly CoverageInput[],
): CoverageSummary {
  const live = inputs.filter((i) => !i.archived);
  const covered = live.filter((i) => i.markedByTemplateIds.length > 0).length;
  return { total: live.length, covered, uncovered: live.length - covered };
}
