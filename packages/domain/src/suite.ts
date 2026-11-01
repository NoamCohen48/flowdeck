/**
 * A product's suite as one document, addressed by readable keys rather than
 * UUIDs. It is what `GET /products/{ref}/suite` returns, what `PUT`
 * replaces the suite with, and what the CLI's folder of files maps to one for
 * one. Archived things are included and say so, because a mark on an archived
 * test is still a mark and an archived template still counts for coverage.
 *
 * The vocabulary is the product's, not the database's: a step is `action` or
 * `check`, it happens on a `device`, a check has an `expect`, and a step
 * `verifies` tests by key.
 */
import { matchDeviceLabel, namesSeveralDevices, otherDevicesMentioned } from "./handoffs.ts";

export type SuiteStepKind = "action" | "check";

export interface SuiteTest {
  /** Stable, unique within the product: lowercase words joined by hyphens. */
  key: string;
  title: string;
  expect: string;
  tags?: string[];
  /** Everything else in the generic bag: priority, category… */
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export interface SuiteStep {
  kind: SuiteStepKind;
  text: string;
  device: string;
  /** Shown for checks. */
  expect?: string | null;
  /** Where the step leaves the tester. */
  after?: string | null;
  /** Test keys. */
  verifies?: string[];
}

export interface SuiteFlow {
  /** Stable, unique within its template. */
  key: string;
  name: string;
  precondition?: string;
  estimateMinutes?: number | null;
  archived?: boolean;
  steps: SuiteStep[];
}

export interface SuiteTemplate {
  /** Stable, unique within the product. */
  key: string;
  name: string;
  description?: string;
  archived?: boolean;
  /** In display order. */
  flows: SuiteFlow[];
}

export interface Suite {
  product: { name: string; description?: string };
  tests: SuiteTest[];
  templates: SuiteTemplate[];
}

/* ── Keys ─────────────────────────────────────────────────────────────── */

export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_MAX = 64;

/**
 * A key from a title: "Sending a message shows it optimistically" →
 * "sending-a-message-shows-it-optimistically". Cut at a word boundary under the
 * cap. Non-Latin titles keep nothing, so they fall back to `fallback`.
 */
export function slugify(text: string, fallback = "item"): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > KEY_MAX) break;
    out = next;
  }
  return out || fallback;
}

/** `base`, or `base-2`, `base-3`… — the first one `taken` does not have. */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const k = `${base.slice(0, KEY_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(k)) return k;
  }
}

/* ── Lint ─────────────────────────────────────────────────────────────── */

/** Verbs that start an instruction. A second one after "and"/"then" means the step is two steps. */
const INSTRUCTION_VERBS = [
  "open", "close", "tap", "press", "long-press", "click", "double-click", "type", "enter", "send", "select",
  "choose", "pick", "scroll", "swipe", "drag", "drop", "go", "navigate", "return", "sign", "log", "switch",
  "add", "delete", "remove", "edit", "save", "rename", "copy", "paste", "upload", "download", "attach",
  "install", "uninstall", "restart", "reload", "refresh", "unlock", "lock", "turn", "enable", "disable",
  "start", "stop", "wait", "check", "verify", "watch", "look", "confirm", "change", "set", "create", "react",
  "reply", "share", "search", "invite", "accept", "dismiss", "allow", "deny", "connect", "disconnect",
];
const VERBS = INSTRUCTION_VERBS.join("|");
const SEVERAL_ACTIONS = new RegExp(`(,?\\s+and\\s+then|,?\\s+then|;\\s*|,?\\s+and|,\\s*)\\s+(${VERBS})\\b`, "gi");
const STARTS_WITH_VERB = new RegExp(`^\\s*(${VERBS})\\b`, "i");

/**
 * "Open the chat and send 'hello'" is two steps: one thing per step, so a
 * failure points at one action and a stale step is one fix. Returns the joint
 * ("and send") when the text chains a second instruction, else undefined.
 * Nouns joined by "and" ("the reaction and its count") are fine, and so is a
 * comma after a lead-in ("As Dana, send…"): a bare comma counts only when the
 * step itself opens with an instruction ("Unlock the iPhone, sign in…").
 */
export function joinsSeveralActions(text: string): string | undefined {
  for (const m of text.matchAll(SEVERAL_ACTIONS)) {
    const bareComma = /^,\s*$/.test(m[1]!);
    if (!bareComma || STARTS_WITH_VERB.test(text)) return m[0].trim();
  }
  return undefined;
}

export interface SuiteProblem {
  /** Errors stop a push; warnings are said and allowed (warn, never block). */
  level: "error" | "warning";
  /** Where, as a path into the suite: ["templates", 0, "flows", 2, "steps", 5, "verifies", 0]. */
  path: (string | number)[];
  message: string;
}

/**
 * Every rule that can be checked from the document alone, so the CLI can say it
 * offline and the server says the same thing on push.
 */
export function lintSuite(suite: Suite): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const error = (path: (string | number)[], message: string) => problems.push({ level: "error", path, message });
  const warn = (path: (string | number)[], message: string) => problems.push({ level: "warning", path, message });

  const testKeys = new Map<string, number>();
  suite.tests.forEach((t, i) => {
    if (!KEY_PATTERN.test(t.key)) error(["tests", i, "key"], `"${t.key}" is not a key: use lowercase letters, digits and single hyphens`);
    if (testKeys.has(t.key)) error(["tests", i, "key"], `test "${t.key}" is defined twice`);
    testKeys.set(t.key, i);
    if (!t.title.trim()) error(["tests", i, "title"], "a test needs a title");
    if (!t.expect.trim()) error(["tests", i, "expect"], "a test needs an expected result: it is an assertion");
  });

  const verified = new Set<string>();
  const templateKeys = new Set<string>();
  const devices = new Set<string>();
  for (const t of suite.templates) for (const f of t.flows) for (const s of f.steps) devices.add(s.device);

  suite.templates.forEach((tpl, ti) => {
    const at = ["templates", ti];
    if (!KEY_PATTERN.test(tpl.key)) error([...at, "key"], `"${tpl.key}" is not a key: use lowercase letters, digits and single hyphens`);
    if (templateKeys.has(tpl.key)) error([...at, "key"], `template "${tpl.key}" is defined twice`);
    templateKeys.add(tpl.key);
    if (!tpl.name.trim()) error([...at, "name"], "a template needs a name");

    const flowKeys = new Set<string>();
    tpl.flows.forEach((flow, fi) => {
      const fat = [...at, "flows", fi];
      if (!KEY_PATTERN.test(flow.key)) error([...fat, "key"], `"${flow.key}" is not a key: use lowercase letters, digits and single hyphens`);
      if (flowKeys.has(flow.key)) error([...fat, "key"], `flow "${flow.key}" is defined twice in template "${tpl.key}"`);
      flowKeys.add(flow.key);
      if (!flow.name.trim()) error([...fat, "name"], "a flow needs a name");
      if (!flow.steps.length && !flow.archived) warn([...fat, "steps"], "this flow has no steps");
      if (flow.estimateMinutes != null && (!Number.isInteger(flow.estimateMinutes) || flow.estimateMinutes <= 0)) {
        error([...fat, "estimateMinutes"], "an estimate is a whole number of minutes");
      }

      // Devices this flow uses, for the one-device-per-step rule.
      const flowDevices = [...new Set(flow.steps.map((s) => s.device))];
      flow.steps.forEach((s, si) => {
        const sat = [...fat, "steps", si];
        if (!s.text.trim()) error([...sat, "text"], "a step needs an instruction");
        if (!s.device.trim()) error([...sat, "device"], "a step happens on a device; name it");
        const joint = joinsSeveralActions(s.text);
        if (joint) warn([...sat, "text"], `"${joint}…": one thing per step — split it into two`);
        if (s.kind === "check" && !s.expect?.trim()) warn([...sat, "expect"], "a check with no expected result: say what the tester should see");
        if (s.kind === "action" && s.expect?.trim()) warn([...sat, "expect"], "an action's expected result is never shown; make it a check, or drop it");

        const near = matchDeviceLabel(s.device, [...devices].filter((d) => d !== s.device));
        if (near) warn([...sat, "device"], `"${s.device}" looks like "${near}": one device, two names gives it two colours and two hand-offs`);
        const others = otherDevicesMentioned(`${s.text} ${s.expect ?? ""}`, s.device, flowDevices);
        const several = namesSeveralDevices(`${s.text} ${s.expect ?? ""}`);
        if (others.length) warn([...sat, "text"], `also names ${others.join(", ")}: a step happens on one device — split it`);
        else if (several) warn([...sat, "text"], `says "${several}": a step happens on one device — split it`);

        const seen = new Set<string>();
        (s.verifies ?? []).forEach((k, ki) => {
          if (seen.has(k)) warn([...sat, "verifies", ki], `"${k}" is listed twice`);
          seen.add(k);
          const ti2 = testKeys.get(k);
          if (ti2 === undefined) error([...sat, "verifies", ki], `no test "${k}": create it, or take it out of verifies`);
          else {
            verified.add(k);
            if (suite.tests[ti2]!.archived && !flow.archived && !tpl.archived) warn([...sat, "verifies", ki], `"${k}" is archived; it no longer counts toward coverage`);
          }
        });
      });
    });
  });

  // Coverage: every live test reachable by some flow somewhere — archived templates count.
  suite.tests.forEach((t, i) => {
    if (!t.archived && !verified.has(t.key)) warn(["tests", i], `"${t.key}" is in no flow: it will never be checked on a testing day`);
  });

  return problems;
}

/** "templates[0].flows[2].steps[5]" — the same rendering the API's `details` use. */
export function formatPath(path: readonly (string | number)[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${p}` : p)).join("");
}
