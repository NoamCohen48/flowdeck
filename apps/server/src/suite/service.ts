/**
 * The three things anyone does with a suite: read it, see what a change
 * would do, and make the change. The routes, the backup restore and the tests
 * all go through here, so a push from the CLI and a restore from the bucket
 * follow exactly the same rules.
 */
import { sql as raw } from "drizzle-orm";
import { lintSuite, type Suite, type SuiteProblem } from "@flowdeck/domain";
import { db } from "../db/client.ts";
import { applySuite } from "./apply.ts";
import { loadStored, revisionOf, toSuite } from "./load.ts";
import { describeChange, planSuite, type Change } from "@flowdeck/domain";

export interface PlanOutcome {
  revision: string;
  changes: Change[];
  summary: string[];
  problems: SuiteProblem[];
}

export type PushOutcome =
  | { ok: true; previousRevision: string; revision: string; changes: Change[]; summary: string[]; problems: SuiteProblem[] }
  | { ok: false; reason: "invalid"; problems: SuiteProblem[] }
  | { ok: false; reason: "stale"; revision: string }
  | { ok: false; reason: "missing" };

export async function getSuite(productId: string) {
  const stored = await loadStored(db, productId);
  return stored && { revision: revisionOf(stored), suite: toSuite(stored) };
}

/** What a push of `desired` would change, without changing it. */
export async function planPush(productId: string, desired: Suite): Promise<PlanOutcome | { invalid: SuiteProblem[] } | undefined> {
  const stored = await loadStored(db, productId);
  if (!stored) return undefined;
  const problems = lintSuite(desired);
  if (problems.some((p) => p.level === "error")) return { invalid: problems };
  const { changes } = planSuite(stored, desired);
  return { revision: revisionOf(stored), changes: [...changes], summary: changes.map(describeChange), problems };
}

/**
 * Replace the product's suite with `desired`, in one transaction. Refused when
 * the suite has moved on since `baseRevision` (someone else pushed, or edited in
 * the app) unless `force`; refused when the document has lint errors. Warnings
 * are returned, never enforced.
 */
export async function pushSuite(
  productId: string,
  input: { suite: Suite; baseRevision?: string; force?: boolean },
  actor: string,
): Promise<PushOutcome> {
  const problems = lintSuite(input.suite);
  if (problems.some((p) => p.level === "error")) return { ok: false, reason: "invalid", problems };

  return db.transaction(async (tx) => {
    // One push at a time per product: the second waits, then sees the first's revision.
    const locked = (await tx.execute(raw`select id from product where id = ${productId} for update`)) as unknown as unknown[];
    if (!locked.length) return { ok: false, reason: "missing" } as const;

    const stored = (await loadStored(tx, productId))!;
    const previousRevision = revisionOf(stored);
    if (!input.force && input.baseRevision !== previousRevision) return { ok: false, reason: "stale", revision: previousRevision } as const;

    const { changes } = planSuite(stored, input.suite);
    if (changes.length) await applySuite(tx, productId, stored, input.suite, actor);
    const revision = changes.length ? revisionOf((await loadStored(tx, productId))!) : previousRevision;
    return { ok: true, previousRevision, revision, changes: [...changes], summary: changes.map(describeChange), problems } as const;
  });
}
