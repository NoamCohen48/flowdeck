/**
 * The app as a graph, and flows worked out from it.
 *
 * Writing long flows by hand is hard: you have to hold the whole app in your
 * head to find an order where each test sets up the next. Instead, the suite
 * can say how a person moves through the app — the graph — and each test can
 * say the state it needs — its `given` — and the flows follow:
 *
 *  - roles     the devices a flow needs, by part ("Phone A"), not by model
 *  - screens   where a role can be, per surface (the phone app, the web app)
 *  - facts     what can be true in the world: a message exists, dark mode is on
 *  - actions   one step on one role: from a screen to a screen, needing some
 *              facts (`!x`: x must be false) and setting others (`-x` clears)
 *  - starts    the states a flow may begin from, with the precondition in words
 *
 * A fact declared `~like-this` is fresh: it holds only until the next action,
 * for checks that must come right after the thing they watch.
 *
 * A test's `given` is a state, never steps: "Phone B on the thread, with a
 * message in it". There is more than one way to get there, and the generator
 * picks the shortest from wherever the flow already is.
 *
 * Deterministic by construction: searches are breadth-first with actions tried
 * in file order, so the same suite always gives the same flows.
 */
import { joinsSeveralActions, KEY_PATTERN, type Suite, type SuiteFlow, type SuiteProblem, type SuiteStep, type SuiteTest } from "./suite.ts";

export interface GraphRole {
  /** What a step's `device` says: "Phone A". */
  name: string;
  /** Which `screens` list this role moves on. */
  surface: string;
  /** The device usually standing in, for people: "Pixel 8". */
  usually?: string;
}

export interface GraphStart {
  /** The precondition, in words: what a tester sets up before the flow. */
  say: string;
  /** Every role's screen. */
  at: Record<string, string>;
}

export interface GraphAction {
  /** A role, or several that can each do it. */
  device: string | string[];
  /** A screen, or several it can be done from. */
  from: string | string[];
  /** Where it leaves the role; the same screen when left out. */
  to?: string;
  do: string;
  /** Facts that must hold; `!x` must not. */
  needs?: string[];
  /** Facts it makes true; `-x` makes x false. */
  sets?: string[];
}

export interface SuiteGraph {
  roles: Record<string, GraphRole>;
  screens: Record<string, string[]>;
  /** Name → what it means. A name starting with `~` is fresh. */
  facts: Record<string, string>;
  starts: Record<string, GraphStart>;
  actions: GraphAction[];
}

/** The state a test needs, and how to look. */
export interface TestGiven {
  /** The role the check happens on. */
  device: string;
  /** Its screen. */
  at: string;
  facts?: string[];
  /** Other roles that must be on a given screen too. */
  also?: Record<string, string>;
  /** The check step's instruction; the test's title when left out. */
  look?: string;
}

/* ── Facts ────────────────────────────────────────────────────────────── */

/** `!x`, `-x`, `~x` and `x` all name the fact `x`. */
export const factName = (ref: string) => ref.replace(/^[!-]/, "").replace(/^~/, "");

const asList = (x: string | string[]) => (Array.isArray(x) ? x : [x]);

/* ── The compiled graph ───────────────────────────────────────────────── */

/** Every role's screen (an index into its surface's list), and the facts as bits. */
interface State {
  at: number[];
  facts: bigint;
}

interface Edge {
  /** Its index in `actions`. */
  action: number;
  role: number;
  from: number;
  to: number;
  text: string;
  needOn: bigint;
  needOff: bigint;
  setOn: bigint;
  setOff: bigint;
}

interface Goal {
  where: [role: number, screen: number][];
  needOn: bigint;
  needOff: bigint;
}

interface Compiled {
  roles: string[];
  /** Per role, its surface's screens by index. */
  screens: string[][];
  /** Fact names by bit. */
  facts: string[];
  edges: Edge[];
  fresh: bigint;
  starts: Map<string, State>;
  goals: Map<string, Goal>;
  /** Per role, per screen: every screen it could ever get to, facts aside. */
  reach: Set<number>[][];
  tests: Map<string, SuiteTest>;
  /** "state>test" → the path, or null when there is none within the limit. */
  paths: Map<string, Found | null>;
}

interface Found {
  edges: number[];
  end: State;
}

const stateKey = (s: State) => `${s.at.join(",")}/${s.facts.toString(36)}`;

/** Compile a graph that `lintGraph` found no errors in. */
function compile(graph: SuiteGraph, tests: readonly SuiteTest[]): Compiled {
  const roles = Object.keys(graph.roles);
  const screenIndex = roles.map((r) => new Map((graph.screens[graph.roles[r]!.surface] ?? []).map((s, i) => [s, i])));
  const factBit = new Map(Object.keys(graph.facts).map((f, i) => [factName(f), 1n << BigInt(i)]));
  let fresh = 0n;
  for (const f of Object.keys(graph.facts)) if (f.startsWith("~")) fresh |= factBit.get(factName(f))!;
  const bits = (refs: readonly string[] | undefined, pick: (ref: string) => boolean) =>
    (refs ?? []).filter(pick).reduce((m, ref) => m | (factBit.get(factName(ref)) ?? 0n), 0n);

  const edges: Edge[] = [];
  for (const [action, a] of graph.actions.entries()) {
    for (const r of asList(a.device)) {
      const role = roles.indexOf(r);
      for (const from of asList(a.from)) {
        edges.push({
          action,
          role,
          from: screenIndex[role]!.get(from)!,
          to: screenIndex[role]!.get(a.to ?? from)!,
          text: a.do,
          needOn: bits(a.needs, (x) => !x.startsWith("!")),
          needOff: bits(a.needs, (x) => x.startsWith("!")),
          setOn: bits(a.sets, (x) => !x.startsWith("-")),
          setOff: bits(a.sets, (x) => x.startsWith("-")),
        });
      }
    }
  }

  const starts = new Map(Object.entries(graph.starts).map(([k, s]) => [k, { at: roles.map((r, i) => screenIndex[i]!.get(s.at[r]!)!), facts: 0n }]));

  const goals = new Map<string, Goal>();
  const live = new Map<string, SuiteTest>();
  for (const t of tests) {
    if (!t.given || t.archived) continue;
    const g = t.given;
    const where = Object.entries({ ...(g.also ?? {}), [g.device]: g.at }).map(([r, s]): [number, number] => {
      const i = roles.indexOf(r);
      return [i, screenIndex[i]!.get(s)!];
    });
    goals.set(t.key, { where, needOn: bits(g.facts, (x) => !x.startsWith("!")), needOff: bits(g.facts, (x) => x.startsWith("!")) });
    live.set(t.key, t);
  }

  const reach = roles.map((_, role) => {
    const next = new Map<number, Set<number>>();
    for (const e of edges) if (e.role === role) next.set(e.from, (next.get(e.from) ?? new Set()).add(e.to));
    return [...screenIndex[role]!.values()].map((s0) => {
      const seen = new Set([s0]);
      const todo = [s0];
      while (todo.length) for (const t of next.get(todo.pop()!) ?? []) if (!seen.has(t)) { seen.add(t); todo.push(t); }
      return seen;
    });
  });

  const screens = roles.map((r) => [...(graph.screens[graph.roles[r]!.surface] ?? [])]);
  return { roles, screens, facts: [...factBit.keys()], edges, fresh, starts, goals, reach, tests: live, paths: new Map() };
}

function move(c: Compiled, s: State, e: Edge): State | undefined {
  if (s.at[e.role] !== e.from || (s.facts & e.needOn) !== e.needOn || (s.facts & e.needOff) !== 0n) return undefined;
  // Fresh facts last until the next action, whoever does it.
  const facts = ((s.facts & ~c.fresh) | e.setOn) & ~e.setOff;
  const at = s.at.slice();
  at[e.role] = e.to;
  return { at, facts };
}

const meets = (s: State, g: Goal) => g.where.every(([r, scr]) => s.at[r] === scr) && (s.facts & g.needOn) === g.needOn && (s.facts & g.needOff) === 0n;

/** Whether a goal's screens can be reached at all from `s`, facts aside: a cheap way to skip a hopeless search. */
const hopeful = (c: Compiled, s: State, g: Goal) => g.where.every(([r, scr]) => c.reach[r]![s.at[r]!]!.has(scr));

/** How many states one search may visit before giving up: a graph with many facts has millions. */
const SEARCH_BUDGET = 200_000;

/**
 * The shortest list of edges from `from` to a state where `goal` holds, at most
 * `limit` long. Breadth-first, edges in file order, so the same graph gives the
 * same path. Null when there is none; undefined when the search gave up.
 */
function pathTo(c: Compiled, from: State, goal: (s: State) => boolean, limit: number): Found | null | undefined {
  if (goal(from)) return { edges: [], end: from };
  const nodes: { state: State; parent: number; edge: number; depth: number }[] = [{ state: from, parent: -1, edge: -1, depth: 0 }];
  const seen = new Set([stateKey(from)]);
  const trail = (i: number) => {
    const out: number[] = [];
    for (let n = nodes[i]!; n.parent !== -1; n = nodes[n.parent]!) out.push(n.edge);
    return out.reverse();
  };
  for (let head = 0; head < nodes.length; head++) {
    const node = nodes[head]!;
    if (node.depth >= limit) continue;
    for (let ei = 0; ei < c.edges.length; ei++) {
      const next = move(c, node.state, c.edges[ei]!);
      if (!next) continue;
      const k = stateKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      nodes.push({ state: next, parent: head, edge: ei, depth: node.depth + 1 });
      if (goal(next)) return { edges: trail(nodes.length - 1), end: next };
      if (seen.size > SEARCH_BUDGET) return undefined;
    }
  }
  return null;
}

/* ── Plans ────────────────────────────────────────────────────────────── */

/**
 * What is kept between runs: per flow, where it starts and which tests it
 * checks, in order. Steps are never kept; they are the shortest path from one
 * test's state to the next, worked out again each time.
 */
export interface FlowPlan {
  start: string;
  tests: string[];
}

type PlannedStep = { kind: "do"; edge: number } | { kind: "check"; test: string };

function materialize(c: Compiled, flow: FlowPlan, limit: number): PlannedStep[] | undefined {
  let state = c.starts.get(flow.start);
  if (!state) return undefined;
  const steps: PlannedStep[] = [];
  for (const key of flow.tests) {
    const goal = c.goals.get(key);
    if (!goal) return undefined;
    // The path depends only on where you are and which test is next.
    const ck = `${stateKey(state)}>${key}`;
    let found = c.paths.get(ck);
    if (found === undefined) {
      found = hopeful(c, state, goal) ? pathTo(c, state, (s) => meets(s, goal), limit) ?? null : null;
      c.paths.set(ck, found);
    }
    if (!found) return undefined;
    for (const e of found.edges) steps.push({ kind: "do", edge: e });
    steps.push({ kind: "check", test: key });
    state = found.end;
  }
  return steps;
}

/** The nearest of `keys` from `state`: the path there and the first key (in order) it satisfies. */
function nearest(c: Compiled, state: State, keys: readonly string[], limit: number) {
  const goals = keys.filter((k) => hopeful(c, state, c.goals.get(k)!)).map((k) => [k, c.goals.get(k)!] as const);
  if (!goals.length) return undefined;
  const found = pathTo(c, state, (s) => goals.some(([, g]) => meets(s, g)), limit);
  if (!found) return undefined;
  return { found, key: goals.find(([, g]) => meets(found.end, g))![0] };
}

/** Greedy from nothing: each flow starts where its first test is nearest, then takes the nearest test left until it is full. */
function freshPlan(c: Compiled, keys: readonly string[], maxSteps: number) {
  const left = [...keys];
  const plan: FlowPlan[] = [];
  while (left.length) {
    let best: { start: string; length: number } | undefined;
    for (const [start, s] of c.starts) {
      const n = nearest(c, s, left, maxSteps);
      if (n && (!best || n.found.edges.length < best.length)) best = { start, length: n.found.edges.length };
    }
    if (!best) break;
    const flow: FlowPlan = { start: best.start, tests: [] };
    let state = c.starts.get(best.start)!;
    let length = 0;
    while (left.length) {
      const n = nearest(c, state, left, maxSteps);
      if (!n) break;
      if (flow.tests.length && length + n.found.edges.length + 1 > maxSteps) break;
      flow.tests.push(n.key);
      left.splice(left.indexOf(n.key), 1);
      state = n.found.end;
      length += n.found.edges.length + 1;
    }
    plan.push(flow);
  }
  return { plan, left };
}

/** Where inserting `key` costs the fewest extra steps: [cost, flow, position]. */
function fit(c: Compiled, plan: readonly FlowPlan[], key: string, maxSteps: number, skip = -1): [number, number, number] | undefined {
  let best: [number, number, number] | undefined;
  plan.forEach((f, fi) => {
    if (fi === skip) return;
    const base = materialize(c, f, maxSteps)?.length ?? 0;
    for (let pos = 0; pos <= f.tests.length; pos++) {
      const steps = materialize(c, { start: f.start, tests: [...f.tests.slice(0, pos), key, ...f.tests.slice(pos)] }, maxSteps);
      if (steps && steps.length <= maxSteps && (!best || steps.length - base < best[0])) best = [steps.length - base, fi, pos];
    }
  });
  return best;
}

/** Greedy filling leaves a short last flow; move a flow's tests into the others when they all fit, smallest flow first. */
function foldSmall(c: Compiled, plan: FlowPlan[], maxSteps: number) {
  let changed = true;
  while (changed && plan.length > 1) {
    changed = false;
    const bySize = plan.map((_, i) => i).sort((a, b) => plan[a]!.tests.length - plan[b]!.tests.length);
    for (const fi of bySize) {
      const trial = plan.map((f) => ({ start: f.start, tests: [...f.tests] }));
      const ok = plan[fi]!.tests.every((key) => {
        const spot = fit(c, trial, key, maxSteps, fi);
        if (spot) trial[spot[1]]!.tests.splice(spot[2], 0, key);
        return !!spot;
      });
      if (ok) {
        plan = trial.filter((_, i) => i !== fi);
        changed = true;
        break;
      }
    }
  }
  return plan;
}

/** Keep what can be kept; fit what is new where it costs the fewest steps; start new flows only for what fits nowhere. */
function updatePlan(c: Compiled, old: readonly FlowPlan[], maxSteps: number) {
  const plan = old
    .filter((f) => c.starts.has(f.start))
    .map((f) => ({ start: f.start, tests: f.tests.filter((k) => c.goals.has(k)) }));
  // A flow the graph no longer allows, or that has grown past the limit, loses tests from the end until it fits.
  const fits = (f: FlowPlan) => (materialize(c, f, maxSteps)?.length ?? Infinity) <= maxSteps;
  const homeless: string[] = [];
  for (const f of plan) while (f.tests.length && !fits(f)) homeless.unshift(f.tests.pop()!);
  const kept = plan.filter((f) => f.tests.length);
  const planned = new Set(kept.flatMap((f) => f.tests));
  const unplaced: string[] = [];
  for (const key of [...[...c.goals.keys()].filter((k) => !planned.has(k) && !homeless.includes(k)), ...homeless]) {
    const spot = fit(c, kept, key, maxSteps);
    if (spot) kept[spot[1]]!.tests.splice(spot[2], 0, key);
    else unplaced.push(key);
  }
  const more = freshPlan(c, unplaced, maxSteps);
  return { plan: [...kept, ...more.plan], left: more.left };
}

/* ── Generating flows ─────────────────────────────────────────────────── */

export interface GenerateOptions {
  /** The longest a flow may be, in steps. */
  maxSteps?: number;
  /** The flows generated last time, to change as little as possible. Left out: plan from nothing. */
  previous?: readonly SuiteFlow[];
}

export interface Generated {
  flows: SuiteFlow[];
  /** Tests with a `given` that no flow could reach within the step limit. */
  unplaced: string[];
  steps: number;
  /** When updating: what planning from nothing would give, so a person can see the drift. */
  fresh?: { flows: number; steps: number };
}

export const DEFAULT_MAX_STEPS = 25;

/** The template generated flows live in. It is rewritten on every run: the edits belong in the graph and the givens. */
export const GENERATED_TEMPLATE = "generated";

/** Read a plan back from generated flows: the start from the precondition, the tests from the checks. */
export function planOf(graph: SuiteGraph, flows: readonly SuiteFlow[]): FlowPlan[] {
  const startBySay = new Map(Object.entries(graph.starts).map(([k, s]) => [s.say.trim(), k]));
  return flows.flatMap((f) => {
    const start = startBySay.get((f.precondition ?? "").trim());
    if (!start || f.archived) return [];
    return [{ start, tests: f.steps.flatMap((s) => (s.kind === "check" ? s.verifies ?? [] : [])) }];
  });
}

/**
 * Flows that check every live test with a `given`, each at most `maxSteps`
 * long and self-contained: it begins from a named start, so flows can run side
 * by side. With `previous`, the flows move as little as possible — tests stay
 * in their flow and new ones go where they cost the fewest steps.
 */
export function generateFlows(suite: Suite, options: GenerateOptions = {}): Generated {
  const graph = suite.graph;
  if (!graph) return { flows: [], unplaced: [], steps: 0 };
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const c = compile(graph, suite.tests);
  const keys = [...c.goals.keys()];

  const fromNothing = () => {
    const f = freshPlan(c, keys, maxSteps);
    return { plan: foldSmall(c, f.plan, maxSteps), left: f.left };
  };
  const length = (plan: readonly FlowPlan[]) => plan.reduce((n, f) => n + (materialize(c, f, maxSteps)?.length ?? 0), 0);

  let result = fromNothing();
  let fresh: Generated["fresh"];
  if (options.previous?.length) {
    const scratch = result;
    result = updatePlan(c, planOf(graph, options.previous), maxSteps);
    fresh = { flows: scratch.plan.length, steps: length(scratch.plan) };
  }

  const flows = result.plan.map((f, i) => renderFlow(graph, c, f, i + 1, maxSteps));
  return {
    flows,
    unplaced: result.left,
    steps: flows.reduce((n, f) => n + f.steps.length, 0),
    ...(fresh ? { fresh } : {}),
  };
}

function stepsOf(graph: SuiteGraph, c: Compiled, planned: readonly PlannedStep[]): SuiteStep[] {
  const nameOf = (role: string) => graph.roles[role]!.name;
  return planned.map((p): SuiteStep => {
    if (p.kind === "do") {
      const e = c.edges[p.edge]!;
      return { kind: "action", text: e.text, device: nameOf(c.roles[e.role]!) };
    }
    const t = c.tests.get(p.test)!;
    return { kind: "check", text: t.given!.look?.trim() || t.title, device: nameOf(t.given!.device), expect: t.expect, verifies: [t.key] };
  });
}

function renderFlow(graph: SuiteGraph, c: Compiled, plan: FlowPlan, n: number, maxSteps: number): SuiteFlow {
  const steps = stepsOf(graph, c, materialize(c, plan, maxSteps)!);
  const first = c.tests.get(plan.tests[0]!)!.title;
  const more = plan.tests.length - 1;
  return {
    key: `flow-${n}`,
    name: more ? `${first}, and ${more} more` : first,
    precondition: graph.starts[plan.start]!.say,
    steps,
  };
}

/* ── Explaining ───────────────────────────────────────────────────────── */

/**
 * Everything that could ever hold from `from`, generously: screens and facts
 * only ever add up, `!x` needs are taken as met and fresh facts never expire.
 * So it errs one way only — what it says can never happen, never can — and it
 * costs one pass per change rather than a search of every state.
 */
function relaxed(c: Compiled, from: readonly State[]) {
  const screens = c.roles.map((_, r) => new Set(from.map((s) => s.at[r]!)));
  let facts = from.reduce((m, s) => m | s.facts, 0n);
  const usable = new Set<number>();
  for (let grew = true; grew; ) {
    grew = false;
    c.edges.forEach((e, i) => {
      if (usable.has(i) || !screens[e.role]!.has(e.from) || (facts & e.needOn) !== e.needOn) return;
      usable.add(i);
      screens[e.role]!.add(e.to);
      facts |= e.setOn;
      grew = true;
    });
  }
  return { screens, facts, usable };
}

const bitNames = (c: Compiled, m: bigint) => c.facts.filter((_, i) => (m >> BigInt(i)) & 1n);

export type Explanation =
  | { test: string; status: "no-given" }
  /** The shortest way there, as steps ending in the check; and how long it is from every start (null: no way). */
  | { test: string; status: "reachable"; start: string; steps: SuiteStep[]; fromEachStart: Record<string, number | null> }
  /** Why not, as sentences a person can act on. */
  | { test: string; status: "unreachable" | "unknown"; reasons: string[] };

/**
 * How a test's given is reached, or why it cannot be: the question to ask
 * when lint says "no start can reach this state", or a generated flow takes a
 * strange way round. `start` limits it to one start.
 */
export function explainGiven(suite: Suite, key: string, start?: string): Explanation {
  const graph = suite.graph;
  const test = suite.tests.find((t) => t.key === key);
  if (!graph || !test?.given) return { test: key, status: "no-given" };
  const c = compile(graph, suite.tests.map((t) => (t.key === key ? { ...t, archived: false } : t)));
  const goal = c.goals.get(key)!;
  const starts = [...c.starts].filter(([k]) => !start || k === start);

  const fromEachStart: Record<string, number | null> = {};
  let best: { start: string; found: Found } | undefined;
  let unsure = false;
  for (const [k, s] of starts) {
    const found = hopeful(c, s, goal) ? pathTo(c, s, (x) => meets(x, goal), Infinity) : null;
    if (found === undefined) unsure = true;
    fromEachStart[k] = found ? found.edges.length : null;
    if (found && (!best || found.edges.length < best.found.edges.length)) best = { start: k, found };
  }
  if (best) {
    const planned: PlannedStep[] = [...best.found.edges.map((edge) => ({ kind: "do" as const, edge })), { kind: "check", test: key }];
    return { test: key, status: "reachable", start: best.start, steps: stepsOf(graph, c, planned), fromEachStart };
  }

  const reasons: string[] = [];
  const doText = (e: Edge) => `"${graph.actions[e.action]!.do}"`;
  for (const [k, s] of starts) {
    const r = relaxed(c, [s]);
    const at = `from ${k}`;
    for (const [role, scr] of goal.where) {
      if (r.screens[role]!.has(scr)) continue;
      const into = c.edges.filter((e) => e.role === role && e.to === scr && e.from !== scr);
      reasons.push(`${at}: ${c.roles[role]} can never get to "${c.screens[role]![scr]}"` + (into.length
        ? `: the ways in (${into.map((e) => `${doText(e)} from ${c.screens[role]![e.from]}`).join("; ")}) are never possible`
        : ": no action leads there"));
    }
    for (const f of bitNames(c, goal.needOn & ~r.facts)) {
      const setters = c.edges.filter((e) => (e.setOn >> BigInt(c.facts.indexOf(f))) & 1n);
      reasons.push(`${at}: "${f}" can never become true` + (setters.length
        ? `: what sets it (${[...new Set(setters.map(doText))].join(", ")}) is never possible`
        : ": no action sets it"));
    }
  }
  if (!reasons.length) {
    // Each part can be had on its own, so it is the combination: find the requirement that, dropped, makes it reachable.
    const parts: { say: string; goal: Goal }[] = [
      ...bitNames(c, goal.needOn).map((f) => {
        const bit = 1n << BigInt(c.facts.indexOf(f));
        const fresh = (c.fresh & bit) !== 0n;
        return { goal: { ...goal, needOn: goal.needOn & ~bit }, say: fresh
          ? `"${f}" is fresh: it is gone after the next action, and the rest of the state takes more actions after it is set — check it straight after, or make it not fresh`
          : `"${f}" cannot be true together with the rest: something on the way there clears it, or needs it false` };
      }),
      ...bitNames(c, goal.needOff).map((f) => {
        const bit = 1n << BigInt(c.facts.indexOf(f));
        return { goal: { ...goal, needOff: goal.needOff & ~bit }, say: `"!${f}": by the time the rest holds, "${f}" is true, and nothing makes it false again` };
      }),
      ...goal.where.filter(([r]) => c.roles[r] !== test.given!.device).map(([r, scr]) => ({
        goal: { ...goal, where: goal.where.filter(([x]) => x !== r) },
        say: `${c.roles[r]} on "${c.screens[r]![scr]}" (also:) cannot be had together with the rest`,
      })),
    ];
    for (const p of parts) {
      if (starts.some(([, s]) => pathTo(c, s, (x) => meets(x, p.goal), Infinity))) reasons.push(p.say);
    }
    if (!reasons.length) reasons.push("each part can be reached alone, but not all together: try dropping facts from the given one at a time");
  }
  if (unsure) return { test: key, status: "unknown", reasons: ["the graph has too many states to search them all, so this is the likely reason, not a proof:", ...reasons] };
  return { test: key, status: "unreachable", reasons };
}

/* ── Checks ───────────────────────────────────────────────────────────── */

/**
 * The graph's own rules and every `given` against it. Errors stop a push, like
 * the rest of `lintSuite`; a test that cannot be reached from any start is an
 * error, because no generated flow could ever check it.
 */
export function lintGraph(suite: Suite): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const error = (path: (string | number)[], message: string) => problems.push({ level: "error", path, message });
  const warn = (path: (string | number)[], message: string) => problems.push({ level: "warning", path, message });
  const graph = suite.graph;

  if (!graph) {
    suite.tests.forEach((t, i) => {
      if (t.given) error(["tests", i, "given"], "a given needs the app's graph (graph.yaml) to say what its screens and facts are");
    });
    return problems;
  }

  const surfaces = new Map(Object.entries(graph.screens).map(([k, list]) => [k, new Set(list)]));
  const roleKeys = Object.keys(graph.roles);
  const facts = new Map<string, string>();
  for (const [surface, list] of Object.entries(graph.screens)) {
    const seen = new Set<string>();
    list.forEach((s, i) => {
      if (seen.has(s)) warn(["graph", "screens", surface, i], `"${s}" is listed twice`);
      seen.add(s);
    });
  }
  if (!roleKeys.length) error(["graph", "roles"], "a graph needs at least one role: the devices a flow uses");
  const roleNames = new Map<string, string>();
  for (const [key, r] of Object.entries(graph.roles)) {
    if (!KEY_PATTERN.test(key)) error(["graph", "roles", key], `"${key}" is not a key: use lowercase letters, digits and single hyphens`);
    if (!r.name.trim()) error(["graph", "roles", key, "name"], "a role needs a name: it is what each step's device says");
    const twin = roleNames.get(r.name.trim());
    if (twin) error(["graph", "roles", key, "name"], `"${r.name}" is also the name of ${twin}: a step could not say which role it is on`);
    roleNames.set(r.name.trim(), key);
    if (!surfaces.has(r.surface)) error(["graph", "roles", key, "surface"], `no surface "${r.surface}" in screens`);
  }
  for (const [f, meaning] of Object.entries(graph.facts)) {
    const name = factName(f);
    if (!meaning?.trim()) warn(["graph", "facts", f], `fact "${name}" says nothing: write what a tester would see when it is true`);
    if (facts.has(name)) error(["graph", "facts", f], `fact "${name}" is declared twice`);
    facts.set(name, f);
  }

  const screensOf = (role: string) => surfaces.get(graph.roles[role]?.surface ?? "") ?? new Set<string>();
  const checkScreen = (path: (string | number)[], role: string, screen: string) => {
    if (!graph.roles[role]) { error(path, `no role "${role}"`); return false; }
    if (!screensOf(role).has(screen)) { error(path, `"${screen}" is not a ${graph.roles[role]!.surface} screen`); return false; }
    return true;
  };
  const checkFacts = (path: (string | number)[], refs: readonly string[] | undefined, allowed: "needs" | "sets") => {
    (refs ?? []).forEach((ref, i) => {
      const bad = allowed === "needs" ? ref.startsWith("-") : ref.startsWith("!");
      if (bad) error([...path, i], allowed === "needs" ? `"${ref}": a need says x or !x (x must be false), not -x` : `"${ref}": a set says x or -x (makes x false), not !x`);
      else if (!facts.has(factName(ref))) error([...path, i], `no fact "${factName(ref)}": declare it under facts`);
    });
  };

  for (const [key, s] of Object.entries(graph.starts)) {
    if (!s.say.trim()) error(["graph", "starts", key, "say"], "a start needs its precondition in words: it is what the tester sets up");
    for (const r of roleKeys) if (!(r in s.at)) error(["graph", "starts", key, "at"], `says nothing about where ${r} is`);
    for (const [r, scr] of Object.entries(s.at)) checkScreen(["graph", "starts", key, "at", r], r, scr);
  }
  if (!Object.keys(graph.starts).length) error(["graph", "starts"], "a graph needs at least one start: the state a flow begins from");

  const needed = new Set<string>();
  const made = new Set<string>();
  graph.actions.forEach((a, i) => {
    const at = ["graph", "actions", i];
    if (!a.do.trim()) error([...at, "do"], "an action needs an instruction");
    const joint = joinsSeveralActions(a.do);
    if (joint) warn([...at, "do"], `"${joint}…": one thing per step — split it into two actions`);
    for (const r of asList(a.device)) {
      for (const from of asList(a.from)) checkScreen([...at, "from"], r, from);
      if (a.to !== undefined) checkScreen([...at, "to"], r, a.to);
    }
    checkFacts([...at, "needs"], a.needs, "needs");
    checkFacts([...at, "sets"], a.sets, "sets");
    for (const f of a.needs ?? []) needed.add(factName(f));
    for (const f of a.sets ?? []) made.add(factName(f));
  });

  suite.tests.forEach((t, i) => {
    const g = t.given;
    if (!g) return;
    const at = ["tests", i, "given"];
    checkScreen([...at, "at"], g.device, g.at);
    for (const [r, scr] of Object.entries(g.also ?? {})) checkScreen([...at, "also", r], r, scr);
    checkFacts([...at, "facts"], g.facts, "needs");
    for (const f of g.facts ?? []) needed.add(factName(f));
    const joint = g.look ? joinsSeveralActions(g.look) : undefined;
    if (joint) warn([...at, "look"], `"${joint}…": one thing per step — a check looks at one thing`);
  });

  for (const [name, declared] of facts) {
    if (needed.has(name) && !made.has(name)) {
      // `!x` alone is satisfiable from the start, where nothing is true yet.
      const onlyNegated = [...graph.actions.flatMap((a) => a.needs ?? []), ...suite.tests.flatMap((t) => t.given?.facts ?? [])]
        .filter((r) => factName(r) === name).every((r) => r.startsWith("!"));
      if (!onlyNegated) error(["graph", "facts", declared], `fact "${name}" is needed but no action makes it true`);
    } else if (!needed.has(name)) warn(["graph", "facts", declared], `fact "${name}" is never needed: drop it, or a test's given is missing it`);
  }

  if (problems.some((p) => p.level === "error")) return problems;

  // A screen a role can reach but never leave strands every flow that goes there.
  for (const r of roleKeys) {
    const out = new Set(graph.actions.filter((a) => asList(a.device).includes(r) && a.to !== undefined).flatMap((a) => asList(a.from).filter((f) => f !== a.to)));
    const reach = new Set(Object.values(graph.starts).map((s) => s.at[r]!));
    const todo = [...reach];
    while (todo.length) {
      const s = todo.pop()!;
      for (const a of graph.actions) {
        if (!asList(a.device).includes(r) || !asList(a.from).includes(s)) continue;
        const to = a.to ?? s;
        if (!reach.has(to)) { reach.add(to); todo.push(to); }
      }
    }
    for (const s of [...reach].sort()) if (!out.has(s)) warn(["graph", "roles", r], `${r} can reach "${s}" but no action leads out of it`);
  }

  // An action no start can ever get to do is a typo in a screen or a fact, or a missing way there.
  const c = compile(graph, suite.tests);
  const { usable } = relaxed(c, [...c.starts.values()]);
  graph.actions.forEach((a, i) => {
    if (c.edges.some((e, ei) => e.action === i && usable.has(ei))) return;
    warn(["graph", "actions", i], `"${a.do}" can never be done: no start gets ${asList(a.device).join(" or ")} to ${asList(a.from).join(" or ")} with ${(a.needs ?? []).filter((n) => !n.startsWith("!")).join(", ") || "what it needs"}`);
  });

  // Every given must be reachable from some start, or no generated flow can check it.
  suite.tests.forEach((t, i) => {
    const goal = c.goals.get(t.key);
    if (!goal) return;
    let unsure = false;
    const reachable = [...c.starts.values()].some((s) => {
      if (!hopeful(c, s, goal)) return false;
      const found = pathTo(c, s, (x) => meets(x, goal), Infinity);
      if (found === undefined) unsure = true;
      return !!found;
    });
    if (reachable) return;
    if (unsure) warn(["tests", i, "given"], "could not tell whether this state can be reached: the graph has too many states to search");
    else error(["tests", i, "given"], "no start can reach this state: check its screen and facts against the actions");
  });

  return problems;
}
