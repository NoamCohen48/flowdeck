/**
 * Core domain types. They are deliberately
 * structural — the domain package never imports a database or a framework.
 */

/** Four result states. */
export type Verdict = "pass" | "fail" | "minor" | "skipped";

/** A step is work or judgment. */
export type StepKind = "action" | "assertion";

export type FlowRunState =
  | "open"
  | "claimed"
  | "finished"
  | "abandoned"
  | "released";

export type TemplateStatus = "active" | "archived";

/**
 * The subset of a step the domain rules need. Callers pass their own richer rows;
 * anything structurally compatible works.
 */
export interface StepLike {
  readonly id: string;
  /** Free text. Abstract ("Device A") or concrete ("Pixel 8"). */
  readonly deviceLabel: string;
  readonly kind: StepKind;
  /** Test IDs this step marks. Zero is normal. */
  readonly marks: readonly string[];
}

export interface ResultLike {
  readonly testId: string;
  readonly verdict: Verdict;
}
