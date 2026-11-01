import type { Verdict } from "./types.ts";

/**
 * Where a tester is in a flow they are still running, for the coordinator.
 *
 * Verdicts stay a draft on the tester's device until Finish, so an abandoned flow
 * leaves nothing behind. Until this existed, the board was therefore blind for
 * the whole of a flow: a blocking failure on step 3 surfaced only when the tester
 * finished, hours later. The runner now publishes this summary as it goes. It is
 * **provisional**: it is shown as "in flight" beside the flow, never counted in
 * the day's numbers, and cleared when the flow is finished or abandoned. The
 * recorded results stay the only source of truth.
 */
export interface LiveProgress {
  /** Zero-based index of the step the tester is on. */
  readonly step: number;
  /** Tests this flow marks, distinct. */
  readonly total: number;
  /** Verdicts drafted so far, one per test (the worst, where a test is marked twice). */
  readonly counts: Readonly<Record<Verdict, number>>;
  /** Zero-based index of the first blocked step, or null when nothing is blocked. */
  readonly blockedFrom: number | null;
  /** Everything that is not a pass, in step order, so the board can show what went wrong right away. A plain array: this is a wire format. */
  readonly issues: LiveIssue[];
  readonly updatedAt: string;
}

export interface LiveIssue {
  /** Zero-based step index. */
  readonly step: number;
  /** Null for a flagged step, which is about the step rather than a test. */
  readonly testId: string | null;
  readonly kind: Exclude<Verdict, "pass"> | "flag";
  readonly note: string;
  readonly blocking: boolean;
}
