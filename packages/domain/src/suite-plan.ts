/**
 * What `PUT /products/{ref}/suite` would change: the stored suite, with ids,
 * against the desired one, with keys. Pure — no database — so every rule below is
 * tested on its own, and `apply.ts` only carries the plan out.
 *
 * The rules:
 *  - Things are matched by key. A key the product does not have is created.
 *  - Anything stored that the desired suite leaves out is archived, never deleted:
 *    history keeps pointing at it, and putting it back restores it.
 *  - An edited test gets a new version; a test whose wording is unchanged
 *    is left alone, so a push of an untouched folder changes nothing.
 *  - Steps have no keys. They are matched by content (see `matchSteps`) so a
 *    step that survives an edit keeps its id: the live editor does not churn and
 *    "Steps to update" links keep working.
 */
import type { Suite, SuiteStep } from "./suite.ts";

/* ── The stored side ──────────────────────────────────────────────────── */

export interface StoredStep {
  readonly id: string;
  readonly kind: "action" | "check";
  readonly text: string;
  readonly device: string;
  readonly expect: string | null;
  readonly after: string | null;
  /** Test ids. */
  readonly verifies: readonly string[];
}

export interface StoredFlow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly precondition: string;
  readonly estimateMinutes: number | null;
  readonly archived: boolean;
  readonly steps: readonly StoredStep[];
}

export interface StoredTemplate {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly archived: boolean;
  readonly flows: readonly StoredFlow[];
}

export interface StoredTest {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly expect: string;
  /** The whole bag, tags included. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly archived: boolean;
}

export interface Stored {
  readonly product: { readonly name: string; readonly description: string };
  readonly tests: readonly StoredTest[];
  readonly templates: readonly StoredTemplate[];
}

/* ── The plan ─────────────────────────────────────────────────────────── */

/** One line of "what would change", for a person or an agent to read. */
export type Change =
  | { op: "update-product"; fields: string[] }
  | { op: "create-test" | "archive-test" | "restore-test"; test: string }
  | { op: "update-test"; test: string; fields: string[] }
  | { op: "create-template" | "archive-template" | "restore-template"; template: string }
  | { op: "update-template"; template: string; fields: string[] }
  | { op: "reorder-flows"; template: string }
  | { op: "create-flow" | "archive-flow" | "restore-flow"; template: string; flow: string }
  | { op: "update-flow"; template: string; flow: string; fields: string[]; steps?: StepCounts };

export interface StepCounts {
  added: number;
  removed: number;
  edited: number;
  moved: number;
}

/** How each desired step maps onto a stored one. */
export interface StepMatch {
  /** Per desired step, in order: the stored step id it continues, or null for a new step. */
  readonly ids: readonly (string | null)[];
  /** Stored steps with no counterpart. */
  readonly removed: readonly string[];
  readonly counts: StepCounts;
}

export interface Plan {
  readonly changes: readonly Change[];
}

/* ── Step matching ────────────────────────────────────────────────────── */

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const identity = (s: { kind: string; device: string; text: string }) => `${s.kind}\u0000${norm(s.device)}\u0000${norm(s.text)}`;

/**
 * Pair desired steps with stored ones, keeping as many ids as the edit allows:
 *
 *  1. Steps whose kind, device and text are unchanged and still in the same
 *     relative order (longest common subsequence) keep their ids.
 *  2. Of the rest, a step whose content is unchanged but which moved keeps its id.
 *  3. Between two kept steps, leftovers pair up in order: a reworded step stays
 *     the same step, with an edit, rather than becoming a delete and an insert.
 */
export function matchSteps(stored: readonly StoredStep[], desired: readonly { kind: string; device: string; text: string }[]): StepMatch {
  const a = stored.map(identity);
  const b = desired.map(identity);
  const n = a.length;
  const m = b.length;

  // 1. LCS table, from the ends.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairOf = new Array<number>(m).fill(-1); // desired index → stored index
  const anchors: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) { pairOf[j] = i; anchors.push([i, j]); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const usedStored = new Set(anchors.map(([i]) => i));

  // 2. Moved, unchanged.
  let moved = 0;
  for (let j = 0; j < m; j++) {
    if (pairOf[j] !== -1) continue;
    const i = a.findIndex((sig, k) => !usedStored.has(k) && sig === b[j]);
    if (i !== -1) { pairOf[j] = i; usedStored.add(i); moved++; }
  }

  // 3. Positional pairing inside each gap between anchors.
  let edited = 0;
  const bounds: [number, number][] = [[-1, -1], ...anchors, [n, m]];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const [i0, j0] = bounds[g]!;
    const [i1, j1] = bounds[g + 1]!;
    const leftStored: number[] = [];
    for (let i = i0 + 1; i < i1; i++) if (!usedStored.has(i)) leftStored.push(i);
    const leftDesired: number[] = [];
    for (let j = j0 + 1; j < j1; j++) if (pairOf[j] === -1) leftDesired.push(j);
    for (let k = 0; k < Math.min(leftStored.length, leftDesired.length); k++) {
      pairOf[leftDesired[k]!] = leftStored[k]!;
      usedStored.add(leftStored[k]!);
      edited++;
    }
  }

  const ids = pairOf.map((i) => (i === -1 ? null : stored[i]!.id));
  const removed = stored.filter((_, i) => !usedStored.has(i)).map((s) => s.id);
  return { ids, removed, counts: { added: ids.filter((x) => x === null).length, removed: removed.length, edited, moved } };
}

/** Whether a stored step needs writing to become the desired one (beyond its position). */
export function stepDiffers(stored: StoredStep, desired: SuiteStep, testIdOf: (key: string) => string | undefined): boolean {
  if (identity(stored) !== identity(desired)) return true;
  if (norm(stored.expect) !== norm(desired.kind === "check" ? desired.expect : null)) return true;
  if (norm(stored.after) !== norm(desired.after)) return true;
  const want = new Set((desired.verifies ?? []).map((k) => testIdOf(k) ?? `?${k}`));
  return want.size !== stored.verifies.length || stored.verifies.some((id) => !want.has(id));
}

/* ── The plan ─────────────────────────────────────────────────────────── */

/** The metadata a test file would hold: `tags` lifted out, the rest as-is. */
export function metadataOf(t: { tags?: readonly string[]; metadata?: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  const { tags: _ignored, ...rest } = (t.metadata ?? {}) as Record<string, unknown>;
  return t.tags?.length ? { ...rest, tags: [...t.tags] } : rest;
}

/** Equal as JSON, whatever order the keys came in. */
export const sameJson = (x: unknown, y: unknown) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(y));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

export function planSuite(stored: Stored, desired: Suite): Plan {
  const changes: Change[] = [];

  const productFields = [
    norm(stored.product.name) !== norm(desired.product.name) ? "name" : null,
    norm(stored.product.description) !== norm(desired.product.description) ? "description" : null,
  ].filter((f): f is string => f !== null);
  if (productFields.length) changes.push({ op: "update-product", fields: productFields });

  // Tests.
  const storedTests = new Map(stored.tests.map((t) => [t.key, t]));
  const desiredTestKeys = new Set(desired.tests.map((t) => t.key));
  for (const t of desired.tests) {
    const s = storedTests.get(t.key);
    if (!s) { changes.push({ op: "create-test", test: t.key }); continue; }
    const fields = [
      norm(s.title) !== norm(t.title) ? "title" : null,
      norm(s.expect) !== norm(t.expect) ? "expect" : null,
      !sameJson(s.metadata, metadataOf(t)) ? "metadata" : null,
    ].filter((f): f is string => f !== null);
    if (fields.length) changes.push({ op: "update-test", test: t.key, fields });
    if (s.archived && !t.archived) changes.push({ op: "restore-test", test: t.key });
    if (!s.archived && t.archived) changes.push({ op: "archive-test", test: t.key });
  }
  for (const s of stored.tests) {
    if (!desiredTestKeys.has(s.key) && !s.archived) changes.push({ op: "archive-test", test: s.key });
  }

  const testIdOf = (key: string) => storedTests.get(key)?.id;

  // Templates and their flows.
  const storedTemplates = new Map(stored.templates.map((t) => [t.key, t]));
  const desiredTemplateKeys = new Set(desired.templates.map((t) => t.key));
  for (const t of desired.templates) {
    const s = storedTemplates.get(t.key);
    if (!s) {
      changes.push({ op: "create-template", template: t.key });
      for (const f of t.flows) changes.push({ op: "create-flow", template: t.key, flow: f.key });
      continue;
    }
    const fields = [
      norm(s.name) !== norm(t.name) ? "name" : null,
      norm(s.description) !== norm(t.description) ? "description" : null,
    ].filter((f): f is string => f !== null);
    if (fields.length) changes.push({ op: "update-template", template: t.key, fields });
    if (s.archived && !t.archived) changes.push({ op: "restore-template", template: t.key });
    if (!s.archived && t.archived) changes.push({ op: "archive-template", template: t.key });

    const storedFlows = new Map(s.flows.map((f) => [f.key, f]));
    const desiredFlowKeys = new Set(t.flows.map((f) => f.key));
    for (const f of t.flows) {
      const sf = storedFlows.get(f.key);
      if (!sf) { changes.push({ op: "create-flow", template: t.key, flow: f.key }); continue; }
      const flowFields = [
        norm(sf.name) !== norm(f.name) ? "name" : null,
        norm(sf.precondition) !== norm(f.precondition) ? "precondition" : null,
        (sf.estimateMinutes ?? null) !== (f.estimateMinutes ?? null) ? "estimate" : null,
      ].filter((x): x is string => x !== null);
      const match = matchSteps(sf.steps, f.steps);
      const byId = new Map(sf.steps.map((st) => [st.id, st]));
      const rewritten = f.steps.filter((st, i) => {
        const id = match.ids[i];
        return id !== null && id !== undefined && stepDiffers(byId.get(id)!, st, testIdOf);
      }).length;
      const reordered = match.counts.moved > 0;
      const stepsChanged = match.counts.added + match.counts.removed + rewritten > 0 || reordered;
      if (flowFields.length || stepsChanged) {
        changes.push({
          op: "update-flow", template: t.key, flow: f.key, fields: stepsChanged ? [...flowFields, "steps"] : flowFields,
          ...(stepsChanged ? { steps: { added: match.counts.added, removed: match.counts.removed, edited: rewritten, moved: match.counts.moved } } : {}),
        });
      }
      if (sf.archived && !f.archived) changes.push({ op: "restore-flow", template: t.key, flow: f.key });
      if (!sf.archived && f.archived) changes.push({ op: "archive-flow", template: t.key, flow: f.key });
    }
    for (const sf of s.flows) {
      if (!desiredFlowKeys.has(sf.key) && !sf.archived) changes.push({ op: "archive-flow", template: t.key, flow: sf.key });
    }
    const storedOrder = s.flows.filter((sf) => desiredFlowKeys.has(sf.key)).map((sf) => sf.key);
    const desiredOrder = t.flows.filter((f) => storedFlows.has(f.key)).map((f) => f.key);
    if (storedOrder.join("\n") !== desiredOrder.join("\n")) changes.push({ op: "reorder-flows", template: t.key });
  }
  for (const s of stored.templates) {
    if (!desiredTemplateKeys.has(s.key) && !s.archived) changes.push({ op: "archive-template", template: s.key });
  }

  return { changes };
}

/** One line per change, the way `flowdeck push --plan` and the API both say it. */
export function describeChange(c: Change): string {
  switch (c.op) {
    case "update-product": return `~ product: ${c.fields.join(", ")}`;
    case "create-test": return `+ test ${c.test}`;
    case "update-test": return `~ test ${c.test}: ${c.fields.join(", ")} (new version)`;
    case "archive-test": return `- test ${c.test} (archived)`;
    case "restore-test": return `+ test ${c.test} (restored)`;
    case "create-template": return `+ template ${c.template}`;
    case "update-template": return `~ template ${c.template}: ${c.fields.join(", ")}`;
    case "archive-template": return `- template ${c.template} (archived)`;
    case "restore-template": return `+ template ${c.template} (restored)`;
    case "reorder-flows": return `~ template ${c.template}: flow order`;
    case "create-flow": return `+ flow ${c.template}/${c.flow}`;
    case "archive-flow": return `- flow ${c.template}/${c.flow} (archived)`;
    case "restore-flow": return `+ flow ${c.template}/${c.flow} (restored)`;
    case "update-flow": {
      const s = c.steps;
      const steps = s ? [s.added && `${s.added} added`, s.edited && `${s.edited} edited`, s.removed && `${s.removed} removed`, s.moved && `${s.moved} moved`].filter(Boolean).join(", ") : "";
      const other = c.fields.filter((f) => f !== "steps");
      return `~ flow ${c.template}/${c.flow}: ${[...other, ...(steps ? [`steps (${steps})`] : [])].join(", ")}`;
    }
  }
}
