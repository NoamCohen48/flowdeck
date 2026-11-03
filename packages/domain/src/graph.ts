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
  /** Facts already true at the start ("an agent is already waiting"). */
  facts?: string[];
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
  /** Other roles that must be on a given screen for it ("the alert shows only while the phone is away"). */
  while?: Record<string, string>;
  /** Where it leaves the tester, shown under the step. */
  after?: string;
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
  /** Other roles' screens it needs. */
  whileAt: [role: number, screen: number][];
}

interface Goal {
  where: [role: number, screen: number][];
  needOn: bigint;
  needOff: bigint;
  /** Worked out on first use: see `relevance`. */
  rel?: Relevance;
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
  /** Per role: the fewest moves from one screen to another, facts aside (Infinity: never). */
  dist: number[][][];
  tests: Map<string, SuiteTest>;
  /**
   * Per test, per state as that test's search sees it: the edges found (or null,
   * or GAVE_UP), and how far it looked. Keyed by what matters to the test only,
   * so a change anywhere else still finds the answer.
   */
  paths: Map<string, Map<bigint, { edges: number[] | null | typeof GAVE_UP; limit: number }>>;
  /** Tests some search for gave up on, so "unreachable" is never said when it is "unknown". */
  gaveUp: Set<string>;
}

const GAVE_UP = "gave-up";

interface Found {
  edges: number[];
  end: State;
}


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
          whileAt: Object.entries(a.while ?? {}).map(([wr, scr]): [number, number] => {
            const i = roles.indexOf(wr);
            return [i, screenIndex[i]!.get(scr)!];
          }),
        });
      }
    }
  }

  const starts = new Map(Object.entries(graph.starts).map(([k, s]) => [k, { at: roles.map((r, i) => screenIndex[i]!.get(s.at[r]!)!), facts: bits(s.facts, () => true) }]));

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
  const dist = roles.map((_, role) => {
    const n = screens[role]!.length;
    const next = new Map<number, Set<number>>();
    for (const e of edges) if (e.role === role) next.set(e.from, (next.get(e.from) ?? new Set()).add(e.to));
    return screens[role]!.map((_, s0) => {
      const d = new Array<number>(n).fill(Infinity);
      d[s0] = 0;
      const queue = [s0];
      for (let i = 0; i < queue.length; i++) for (const t of next.get(queue[i]!) ?? []) if (d[t] === Infinity) { d[t] = d[queue[i]!]! + 1; queue.push(t); }
      return d;
    });
  });
  return { roles, screens, facts: [...factBit.keys()], edges, fresh, starts, goals, reach, dist, tests: live, paths: new Map(), gaveUp: new Set() };
}

function move(c: Compiled, s: State, e: Edge): State | undefined {
  if (s.at[e.role] !== e.from || (s.facts & e.needOn) !== e.needOn || (s.facts & e.needOff) !== 0n) return undefined;
  if (e.whileAt.some(([r, scr]) => s.at[r] !== scr)) return undefined;
  // Fresh facts last until the next action, whoever does it.
  const facts = ((s.facts & ~c.fresh) | e.setOn) & ~e.setOff;
  const at = s.at.slice();
  at[e.role] = e.to;
  return { at, facts };
}

const meets = (s: State, g: Goal) => g.where.every(([r, scr]) => s.at[r] === scr) && (s.facts & g.needOn) === g.needOn && (s.facts & g.needOff) === 0n;

/** Whether a goal's screens can be reached at all from `s`, facts aside: a cheap way to skip a hopeless search. */
const hopeful = (c: Compiled, s: State, g: Goal) => g.where.every(([r, scr]) => c.reach[r]![s.at[r]!]!.has(scr));

/** How many states one search may visit before giving up. */
const SEARCH_BUDGET = 200_000;

/**
 * What can matter on the way to `goal`. A big app has dozens of facts, and
 * every on-or-off fact doubles the states there are; but most of them have
 * nothing to do with any one test. So, working back from the goal: the roles
 * and facts it names matter; an action that moves a role that matters, or
 * changes a fact that matters, matters; and then so do the role it is done on
 * and everything it needs. Everything else is left out of the search, which
 * keeps it small and still finds the shortest way: an action that changes
 * nothing that matters can never help.
 */
interface Relevance {
  edges: number[];
  roles: number[];
  facts: bigint;
  /** Per fact the goal needs true: the edges that make it true. */
  setters: [bit: bigint, edges: Edge[]][];
  /** A state as the search sees it: one number from the facts and screens that matter. */
  key: (s: State) => bigint;
}

function relevance(c: Compiled, goal: Goal): Relevance {
  if (goal.rel) return goal.rel;
  const roles = new Set(goal.where.map(([r]) => r));
  let facts = goal.needOn | goal.needOff;
  let needFreshOff = (goal.needOff & c.fresh) !== 0n;
  const picked = new Set<number>();
  for (let grew = true; grew; ) {
    grew = false;
    c.edges.forEach((e, i) => {
      if (picked.has(i)) return;
      // A fresh fact that must be false is cleared by any action at all; the actions of the roles that
      // already matter are enough to clear it, and keep the search small.
      const clears = needFreshOff && roles.has(e.role);
      if (!clears && !((roles.has(e.role) && e.from !== e.to) || ((e.setOn | e.setOff) & facts) !== 0n)) return;
      picked.add(i);
      grew = true;
      roles.add(e.role);
      for (const [r] of e.whileAt) roles.add(r);
      facts |= e.needOn | e.needOff;
      if ((e.needOff & c.fresh) !== 0n) needFreshOff = true;
    });
  }
  const setters = c.facts.map((_, i) => 1n << BigInt(i)).filter((bit) => (goal.needOn & bit) !== 0n)
    .map((bit): [bigint, Edge[]] => [bit, c.edges.filter((e) => (e.setOn & bit) !== 0n)]);
  const order = [...roles].sort((a, b) => a - b);
  // Each role's screen in `width` bits, packed into a plain number while it fits, then the facts above them.
  const width = Math.max(1, ...c.screens.map((list) => list.length)).toString(2).length;
  const shift = BigInt(width * order.length);
  const packed = width * order.length <= 52;
  const key = (s: State) => {
    if (packed) {
      let n = 0;
      for (const r of order) n = n * 2 ** width + s.at[r]!;
      return ((s.facts & facts) << shift) | BigInt(n);
    }
    let k = s.facts & facts;
    for (const r of order) k = (k << BigInt(width)) | BigInt(s.at[r]!);
    return k;
  };
  goal.rel = { edges: [...picked].sort((a, b) => a - b), roles: order, facts, setters, key };
  return goal.rel;
}

/**
 * At least how many more actions `s` needs to meet `goal`: each role must still
 * walk to its screen, and a fact still false needs one of its setters, whose
 * role must walk to where it is done first. Never more than the truth, so a
 * state it rules out could never have made the limit.
 */
function atLeast(c: Compiled, s: State, goal: Goal, rel: Relevance): number {
  let h = 0;
  for (const [r, scr] of goal.where) h = Math.max(h, c.dist[r]![s.at[r]!]![scr]!);
  for (const [bit, setters] of rel.setters) {
    if ((s.facts & bit) !== 0n) continue;
    let best = Infinity;
    for (const e of setters) best = Math.min(best, c.dist[e.role]![s.at[e.role]!]![e.from]! + 1);
    h = Math.max(h, best);
  }
  if ((s.facts & goal.needOff) !== 0n) h = Math.max(h, 1);
  return h;
}

/**
 * The shortest list of edges from `from` to a state that meets `goal`, at most
 * `limit` long. A*, with `atLeast` as the guide: it heads for the goal first and
 * still finds a shortest way, and it never looks at a state that could not make
 * the limit. Ties go to the deeper state, then to the one found first — edges
 * are tried in file order — so the same graph always gives the same path. Null
 * when there is none; GAVE_UP when the search ran out of states.
 */
function search(c: Compiled, from: State, goal: Goal, limit: number): Found | null | typeof GAVE_UP {
  if (meets(from, goal)) return { edges: [], end: from };
  if (!hopeful(c, from, goal)) return null;
  const rel = relevance(c, goal);
  const key = rel.key;
  const h0 = atLeast(c, from, goal, rel);
  if (h0 > limit) return null;
  const nodes: { state: State; parent: number; edge: number; g: number; f: number }[] = [{ state: from, parent: -1, edge: -1, g: 0, f: h0 }];
  const best = new Map([[key(from), 0]]);
  const heap = new Heap((a, b) => {
    const x = nodes[a]!, y = nodes[b]!;
    return x.f !== y.f ? x.f < y.f : x.g !== y.g ? x.g > y.g : a < b;
  });
  heap.push(0);
  while (heap.size) {
    const i = heap.pop();
    const node = nodes[i]!;
    if (best.get(key(node.state))! < node.g) continue;
    if (meets(node.state, goal)) {
      const out: number[] = [];
      for (let n = node; n.parent !== -1; n = nodes[n.parent]!) out.push(n.edge);
      return { edges: out.reverse(), end: node.state };
    }
    if (node.g >= limit) continue;
    for (const ei of rel.edges) {
      const next = move(c, node.state, c.edges[ei]!);
      if (!next) continue;
      const k = key(next);
      const g = node.g + 1;
      if ((best.get(k) ?? Infinity) <= g) continue;
      const f = g + atLeast(c, next, goal, rel);
      if (f > limit) continue;
      best.set(k, g);
      nodes.push({ state: next, parent: i, edge: ei, g, f });
      heap.push(nodes.length - 1);
      if (best.size > SEARCH_BUDGET) return GAVE_UP;
    }
  }
  return null;
}

/** A binary heap of indices, ordered by `before`. */
class Heap {
  private items: number[] = [];
  constructor(private before: (a: number, b: number) => boolean) {}
  get size() { return this.items.length; }
  push(x: number) {
    const a = this.items;
    a.push(x);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.before(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The way from `state` to test `key`'s state, cached. The way depends only on
 * the facts and screens that matter to the test, so that is the cache key; the
 * state it ends in is the edges played from where you really are.
 */
function hop(c: Compiled, state: State, key: string, limit: number): Found | null {
  const goal = c.goals.get(key)!;
  if (meets(state, goal)) return { edges: [], end: state };
  const rel = relevance(c, goal);
  let byState = c.paths.get(key);
  if (!byState) c.paths.set(key, (byState = new Map()));
  const k = rel.key(state);
  const cached = byState.get(k);
  // A way found is the shortest there is, whatever limit it was found within; "none" holds only up to the limit it looked to.
  const reusable = cached && (cached.edges === null ? cached.limit >= limit : cached.edges === GAVE_UP ? cached.limit === limit : true);
  let edges: number[] | null | typeof GAVE_UP;
  if (reusable) edges = Array.isArray(cached.edges) && cached.edges.length > limit ? null : cached.edges;
  else {
    const found = search(c, state, goal, limit);
    edges = found && found !== GAVE_UP ? found.edges : found;
    byState.set(k, { edges, limit });
  }
  if (edges === GAVE_UP) { c.gaveUp.add(key); return null; }
  if (!edges) return null;
  let end = state;
  for (const e of edges) end = move(c, end, c.edges[e]!)!;
  return { edges, end };
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

/** A plan's steps, and how many leading actions are setup to fold into the precondition. */
interface Built {
  steps: PlannedStep[];
  cut: number;
}

/** How long a flow is for the tester: its steps, less the setup folded into the precondition. */
const cost = (b: Built) => b.steps.length - b.cut;

/** Generation settings every plan is built with. */
interface Settings {
  maxSteps: number;
  /** Fold leading setup into the precondition when it is at least this many actions; Infinity never. */
  setup: number;
}

/**
 * How many of a flow's first actions are only setup: they come before its
 * first check, so they check nothing, and how they are done does not matter.
 * They can go, and the state they reach becomes part of the precondition. What
 * the check is about stays: the action that makes one of its facts true (or
 * false) and everything after it — "Revoke the tablet", "Refresh", then look —
 * and always at least the last action. A fresh fact only exists right after its
 * action, so the cut never lands where one is true.
 */
function setupCut(c: Compiled, start: State, edges: readonly number[], goal: Goal, min: number): number {
  let keepFrom = edges.length - 1;
  edges.forEach((e, i) => {
    const edge = c.edges[e]!;
    if ((edge.setOn & goal.needOn) !== 0n || (edge.setOff & goal.needOff) !== 0n) keepFrom = Math.min(keepFrom, i);
  });
  let state = start, cut = 0;
  edges.slice(0, keepFrom).forEach((e, i) => {
    state = move(c, state, c.edges[e]!)!;
    if ((state.facts & c.fresh) === 0n) cut = i + 1;
  });
  return cut >= min ? cut : 0;
}

/** A plan's steps, or undefined when some test cannot be reached in order within the limit (or `cap`, when lower). */
function build(c: Compiled, flow: FlowPlan, set: Settings, cap = set.maxSteps): Built | undefined {
  const start = c.starts.get(flow.start);
  if (!start) return undefined;
  let state = start, cut = 0;
  const steps: PlannedStep[] = [];
  for (const [i, key] of flow.tests.entries()) {
    if (!c.goals.has(key)) return undefined;
    // A hop never needs to look further than the room the flow has left.
    const room = i === 0 ? set.maxSteps : cap - (steps.length - cut) - 1;
    if (room < 0) return undefined;
    const found = hop(c, state, key, room);
    if (!found) return undefined;
    for (const e of found.edges) steps.push({ kind: "do", edge: e });
    if (i === 0) cut = setupCut(c, start, found.edges, c.goals.get(key)!, set.setup);
    steps.push({ kind: "check", test: key });
    state = found.end;
  }
  return steps.length - cut <= cap ? { steps, cut } : undefined;
}

/** Shorter first; between equally short paths, the one taking earlier actions in the file (what one search over all of them would find first). */
function before(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return a.length < b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** The nearest of `keys` from `state`: the path there, and which key. */
function nearest(c: Compiled, state: State, keys: readonly string[], limit: number) {
  let best: { found: Found; key: string } | undefined;
  for (const key of keys) {
    // Nothing longer than the best so far can win, so no search needs to look further.
    const found = hop(c, state, key, best ? Math.min(limit, best.found.edges.length) : limit);
    if (found && (!best || before(found.edges, best.found.edges))) best = { found, key };
  }
  return best;
}

/** Greedy from nothing: each flow starts where its first test is cheapest, then takes the nearest test left until it is full. */
function freshPlan(c: Compiled, keys: readonly string[], set: Settings) {
  const left = [...keys];
  const plan: FlowPlan[] = [];
  while (left.length) {
    let best: { start: string; cost: number; length: number } | undefined;
    for (const [start, s] of c.starts) {
      const n = nearest(c, s, left, set.maxSteps);
      const b = n && build(c, { start, tests: [n.key] }, set);
      if (b && (!best || cost(b) < best.cost || (cost(b) === best.cost && b.steps.length < best.length))) best = { start, cost: cost(b), length: b.steps.length };
    }
    if (!best) break;
    const flow: FlowPlan = { start: best.start, tests: [] };
    let state = c.starts.get(best.start)!;
    let length = 0;
    while (left.length) {
      const n = nearest(c, state, left, flow.tests.length ? set.maxSteps - length - 1 : set.maxSteps);
      const b = n && build(c, { start: flow.start, tests: [...flow.tests, n.key] }, set);
      if (!n || !b) break;
      flow.tests.push(n.key);
      left.splice(left.indexOf(n.key), 1);
      state = n.found.end;
      length = cost(b);
    }
    if (!flow.tests.length) break;
    plan.push(flow);
  }
  return { plan, left };
}

/** Where inserting `key` costs the fewest extra steps: [cost, flow, position]. */
function fit(c: Compiled, plan: readonly FlowPlan[], key: string, set: Settings, skip = -1): [number, number, number] | undefined {
  let best: [number, number, number] | undefined;
  plan.forEach((f, fi) => {
    // One step (the check itself) is the least a test can add: nothing beats it, and a full flow cannot take it.
    if (fi === skip || best?.[0] === 1) return;
    const was = build(c, f, set);
    const base = was ? cost(was) : 0;
    if (was && base + 1 > set.maxSteps) return;
    for (let pos = 0; pos <= f.tests.length && best?.[0] !== 1; pos++) {
      // Only an insertion cheaper than the best so far matters, so no search needs to look further than that.
      const cap = Math.min(set.maxSteps, best ? base + best[0] - 1 : set.maxSteps);
      const b = build(c, { start: f.start, tests: [...f.tests.slice(0, pos), key, ...f.tests.slice(pos)] }, set, cap);
      if (b && (!best || cost(b) - base < best[0])) best = [cost(b) - base, fi, pos];
    }
  });
  return best;
}

/** Greedy filling leaves a short last flow; move a flow's tests into the others when they all fit, smallest flow first. */
function foldSmall(c: Compiled, plan: FlowPlan[], set: Settings) {
  let changed = true;
  while (changed && plan.length > 1) {
    changed = false;
    const bySize = plan.map((_, i) => i).sort((a, b) => plan[a]!.tests.length - plan[b]!.tests.length);
    for (const fi of bySize) {
      const trial = plan.map((f) => ({ start: f.start, tests: [...f.tests] }));
      const ok = plan[fi]!.tests.every((key) => {
        const spot = fit(c, trial, key, set, fi);
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
function updatePlan(c: Compiled, old: readonly FlowPlan[], set: Settings) {
  const plan = old
    .filter((f) => c.starts.has(f.start))
    .map((f) => ({ start: f.start, tests: f.tests.filter((k) => c.goals.has(k)) }));
  // A flow the graph no longer allows, or that has grown past the limit, loses tests from the end until it fits.
  const homeless: string[] = [];
  for (const f of plan) while (f.tests.length && !build(c, f, set)) homeless.unshift(f.tests.pop()!);
  const kept = plan.filter((f) => f.tests.length);
  const planned = new Set(kept.flatMap((f) => f.tests));
  const unplaced: string[] = [];
  for (const key of [...[...c.goals.keys()].filter((k) => !planned.has(k) && !homeless.includes(k)), ...homeless]) {
    const spot = fit(c, kept, key, set);
    if (spot) kept[spot[1]]!.tests.splice(spot[2], 0, key);
    else unplaced.push(key);
  }
  const more = freshPlan(c, unplaced, set);
  return { plan: [...kept, ...more.plan], left: more.left };
}

/* ── Generating flows ─────────────────────────────────────────────────── */

export interface GenerateOptions {
  /** The longest a flow may be, in steps. */
  maxSteps?: number;
  /**
   * Fold a flow's leading setup — the actions before its first check — into its
   * precondition when there are at least this many: the tester gets to that
   * state however they like. Infinity keeps every step. Default 3.
   */
  setupSteps?: number;
  /** The flows generated last time, to change as little as possible. Left out: plan from nothing. */
  previous?: readonly SuiteFlow[];
}

export interface Generated {
  flows: SuiteFlow[];
  /** Tests with a `given` that no flow could reach within the step limit. */
  unplaced: string[];
  /** Of those, the ones where a search ran out of states: not proven unreachable, just too big to search. */
  gaveUp: string[];
  steps: number;
  /** When updating: what planning from nothing would give, so a person can see the drift. */
  fresh?: { flows: number; steps: number };
}

export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_SETUP_STEPS = 3;

/** The template generated flows live in. It is rewritten on every run: the edits belong in the graph and the givens. */
export const GENERATED_TEMPLATE = "generated";

/** Read a plan back from generated flows: the start from the precondition, the tests from the checks. */
export function planOf(graph: SuiteGraph, flows: readonly SuiteFlow[]): FlowPlan[] {
  // A precondition is the start's words, then any setup folded into it: the longest start that begins it.
  const starts = Object.entries(graph.starts).sort(([, a], [, b]) => b.say.trim().length - a.say.trim().length);
  return flows.flatMap((f) => {
    const pre = (f.precondition ?? "").trim();
    const start = starts.find(([, s]) => pre === s.say.trim() || pre.startsWith(`${s.say.trim()}\n`) || pre.startsWith(`${s.say.trim()} `))?.[0];
    if (!start || f.archived) return [];
    return [{ start, tests: f.steps.flatMap((s) => (s.kind === "check" ? s.verifies ?? [] : [])) }];
  });
}

/**
 * Flows that check every live test with a `given`, each at most `maxSteps`
 * long and self-contained: its precondition says the whole state it begins
 * from — a named start, plus any setup folded into it — so it does not depend
 * on what ran before. With `previous`, the flows move as little as possible:
 * tests stay in their flow and new ones go where they cost the fewest steps.
 */
export function generateFlows(suite: Suite, options: GenerateOptions = {}): Generated {
  const graph = suite.graph;
  if (!graph) return { flows: [], unplaced: [], gaveUp: [], steps: 0 };
  const set: Settings = { maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS, setup: options.setupSteps ?? DEFAULT_SETUP_STEPS };
  const c = compile(graph, suite.tests);
  const keys = [...c.goals.keys()];

  const fromNothing = () => {
    const f = freshPlan(c, keys, set);
    return { plan: foldSmall(c, f.plan, set), left: f.left };
  };
  const length = (plan: readonly FlowPlan[]) => plan.reduce((n, f) => { const b = build(c, f, set); return n + (b ? cost(b) : 0); }, 0);

  let result: { plan: FlowPlan[]; left: string[] };
  let fresh: Generated["fresh"];
  let flows: SuiteFlow[];
  if (options.previous?.length) {
    result = updatePlan(c, planOf(graph, options.previous), set);
    flows = result.plan.map((f, i) => renderFlow(graph, c, f, i + 1, set));
    // Planning from nothing is only for saying how far an update has drifted; when nothing moved,
    // the run that wrote these flows already said it.
    if (JSON.stringify(flows) !== JSON.stringify(options.previous.filter((f) => !f.archived))) {
      const scratch = fromNothing();
      fresh = { flows: scratch.plan.length, steps: length(scratch.plan) };
    }
  } else {
    result = fromNothing();
    flows = result.plan.map((f, i) => renderFlow(graph, c, f, i + 1, set));
  }

  return {
    flows,
    unplaced: result.left,
    gaveUp: result.left.filter((k) => c.gaveUp.has(k)),
    steps: flows.reduce((n, f) => n + f.steps.length, 0),
    ...(fresh ? { fresh } : {}),
  };
}

function stepsOf(graph: SuiteGraph, c: Compiled, planned: readonly PlannedStep[]): SuiteStep[] {
  const nameOf = (role: string) => graph.roles[role]!.name;
  return planned.map((p): SuiteStep => {
    if (p.kind === "do") {
      const e = c.edges[p.edge]!;
      const after = graph.actions[e.action]!.after;
      return { kind: "action", text: e.text, device: nameOf(c.roles[e.role]!), ...(after ? { after } : {}) };
    }
    const t = c.tests.get(p.test)!;
    return { kind: "check", text: t.given!.look?.trim() || t.title, device: nameOf(t.given!.device), expect: t.expect, verifies: [t.key] };
  });
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** What changed from `from` to `to`, in the graph's words: where each role is now, and what is true or no longer true, of the facts in `matter`. */
function describeState(graph: SuiteGraph, c: Compiled, from: State, to: State, matter: bigint): string[] {
  const meaning = (i: number) => {
    const name = c.facts[i]!;
    return graph.facts[name] ?? graph.facts[`~${name}`] ?? name;
  };
  const out: string[] = [];
  c.roles.forEach((r, i) => {
    if (from.at[i] !== to.at[i]) out.push(`${graph.roles[r]!.name} is on ${c.screens[i]![to.at[i]!]}.`);
  });
  c.facts.forEach((_, i) => {
    const bit = 1n << BigInt(i);
    if (!(matter & bit)) return;
    if ((to.facts & bit) && !(from.facts & bit)) out.push(sentence(meaning(i)));
    if (!(to.facts & bit) && (from.facts & bit)) out.push(`No longer: ${sentence(meaning(i)).replace(/^./, (x) => x.toLowerCase())}`);
  });
  return out;
}

/** "Pairing, tablet, reconnect": the tests' tags in the order they come, else the first and last test. */
function flowName(tests: readonly SuiteTest[]): string {
  const tags = [...new Set(tests.flatMap((t) => t.tags ?? []))];
  if (tags.length) return `${tags.slice(0, 3).map((t, i) => (i ? t : t.replace(/^./, (x) => x.toUpperCase()))).join(", ")}${tags.length > 3 ? "…" : ""} (${tests.length} ${tests.length === 1 ? "test" : "tests"})`;
  if (tests.length === 1) return tests[0]!.title;
  return `${tests[0]!.title} … ${tests[tests.length - 1]!.title} (${tests.length} tests)`;
}

function renderFlow(graph: SuiteGraph, c: Compiled, plan: FlowPlan, n: number, set: Settings): SuiteFlow {
  const built = build(c, plan, set)!;
  const start = c.starts.get(plan.start)!;
  let reached = start;
  for (const p of built.steps.slice(0, built.cut)) if (p.kind === "do") reached = move(c, reached, c.edges[p.edge]!)!;
  // Only what the rest of the flow depends on: facts its tests or its remaining actions name.
  const rest = built.steps.slice(built.cut);
  const matter = rest.reduce((m, p) => {
    if (p.kind === "do") { const e = c.edges[p.edge]!; return m | e.needOn | e.needOff | e.setOff; }
    const g = c.goals.get(p.test)!;
    return m | g.needOn | g.needOff;
  }, 0n);
  const setup = built.cut ? describeState(graph, c, start, reached, matter) : [];
  const say = graph.starts[plan.start]!.say.trim();
  return {
    key: `flow-${n}`,
    name: flowName(plan.tests.map((k) => c.tests.get(k)!)),
    precondition: setup.length ? `${say}\nThen, any way you like: ${setup.join(" ")}` : say,
    steps: stepsOf(graph, c, built.steps.slice(built.cut)),
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
      if (e.whileAt.some(([r, scr]) => !screens[r]!.has(scr))) return;
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
    const result = search(c, s, goal, Infinity);
    if (result === GAVE_UP) unsure = true;
    const found = result === GAVE_UP ? null : result;
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
      const results = starts.map(([, st]) => search(c, st, p.goal, Infinity));
      if (results.some((r) => r && r !== GAVE_UP)) reasons.push(p.say);
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
    (s.facts ?? []).forEach((ref, i) => {
      const at = ["graph", "starts", key, "facts", i];
      if (/^[!-]/.test(ref)) error(at, `"${ref}": a start lists the facts that are true; leave out the ones that are not`);
      else if (!facts.has(factName(ref))) error(at, `no fact "${factName(ref)}": declare it under facts`);
      else if (facts.get(factName(ref))!.startsWith("~")) error(at, `"${factName(ref)}" is fresh: it is true only right after an action, never at a start`);
    });
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
    for (const [r, scr] of Object.entries(a.while ?? {})) {
      if (asList(a.device).includes(r)) error([...at, "while", r], `${r} does the action itself: say where it is with "from"`);
      else checkScreen([...at, "while", r], r, scr);
    }
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

  for (const s of Object.values(graph.starts)) for (const f of s.facts ?? []) made.add(factName(f));
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
      const found = search(c, s, goal, Infinity);
      if (found === GAVE_UP) unsure = true;
      return !!found && found !== GAVE_UP;
    });
    if (reachable) return;
    if (unsure) warn(["tests", i, "given"], "could not tell whether this state can be reached: the graph has too many states to search");
    else error(["tests", i, "given"], "no start can reach this state: check its screen and facts against the actions");
  });

  return problems;
}
