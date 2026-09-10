import type { StepLike } from "./types.ts";

/**
 * Blocking failures (D11).
 *
 * The tester decides, at the moment of maximum context, whether a failure wedges the
 * rest of the flow. Both naive alternatives lose information: hard-stopping on every
 * failure kills eighteen remaining steps for one broken tooltip, and always continuing
 * records verdicts about a wedged app, which is a lie.
 *
 * Blocked steps report as **not verified**, never as failures — nobody looked at them.
 */
export interface BlockedView {
  /** Index of the step whose failure blocked the flow, if any. */
  readonly blockedFromIndex: number | undefined;
  readonly blockedStepIds: ReadonlySet<string>;
  /** Tests that will go unverified because their only step in this flow is blocked. */
  readonly unverifiedTestIds: ReadonlySet<string>;
}

export function computeBlocked(
  steps: readonly StepLike[],
  /** Index of the step carrying a blocking failure, or undefined if none. */
  blockingStepIndex: number | undefined,
): BlockedView {
  if (blockingStepIndex === undefined || blockingStepIndex < 0) {
    return {
      blockedFromIndex: undefined,
      blockedStepIds: new Set(),
      unverifiedTestIds: new Set(),
    };
  }

  // The blocking step itself is not blocked — it was executed, and it failed.
  const after = steps.slice(blockingStepIndex + 1);
  const blockedStepIds = new Set(after.map((s) => s.id));
  const unverifiedTestIds = new Set(after.flatMap((s) => [...s.marks]));

  return {
    blockedFromIndex: blockingStepIndex + 1,
    blockedStepIds,
    unverifiedTestIds,
  };
}
