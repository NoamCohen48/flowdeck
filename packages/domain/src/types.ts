/**
 * Core domain types. These mirror `.docs/01-domain-model.md` and are deliberately
 * structural — the domain package never imports a database or a framework.
 */

/** `.docs/03-execution.md` — four result states, D13. */
export type Verdict = "pass" | "fail" | "minor" | "skipped";

/** `.docs/01-domain-model.md` — a step is work or judgment, D14. */
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
  /** Free text (D16). Abstract ("Device A") or concrete ("Pixel 8"). */
  readonly deviceLabel: string;
  readonly kind: StepKind;
  /** Test IDs this step marks. Zero is normal. */
  readonly marks: readonly string[];
}

export interface ResultLike {
  readonly testId: string;
  readonly verdict: Verdict;
}
