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

/**
 * Where a flow stops. Two things can wedge it: a failure the tester said blocks
 * (D11), and a step the tester flagged as wrong and could not get past (D40).
 * Both feed `computeBlocked` the same way — the earliest one wins, and nothing
 * after it is verifiable.
 */
export function blockingStepIndex(
  steps: readonly { readonly id: string }[],
  blockers: readonly { readonly stepId: string; readonly blocking: boolean }[],
): number | undefined {
  const blockingIds = new Set(blockers.filter((b) => b.blocking).map((b) => b.stepId));
  if (!blockingIds.size) return undefined;
  const index = steps.findIndex((s) => blockingIds.has(s.id));
  return index === -1 ? undefined : index;
}
