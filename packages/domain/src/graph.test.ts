import { describe, expect, test } from "bun:test";
import { explainGiven, GENERATED_TEMPLATE, generateFlows, lintGraph, planOf, type SuiteGraph } from "./graph.ts";
import { metadataOf, planSuite, type Stored } from "./suite-plan.ts";
import { lintSuite, type Suite, type SuiteTest } from "./suite.ts";

/** A small chat app: two phones, a thread, messages, and a fresh "just sent". */
const graph = (): SuiteGraph => ({
  roles: {
    "phone-a": { name: "Phone A", surface: "phone", usually: "Pixel 8" },
    "phone-b": { name: "Phone B", surface: "phone" },
  },
  screens: { phone: ["sign-in", "channels", "thread", "settings"] },
  facts: { message: "A message is in the thread", dark: "Dark theme is on", "~sent": "Just sent" },
  starts: {
    "signed-in": { say: "Both phones signed in, on the channel list.", at: { "phone-a": "channels", "phone-b": "channels" } },
    "signed-out": { say: "Both phones signed out.", at: { "phone-a": "sign-in", "phone-b": "sign-in" } },
  },
  actions: [
    { device: ["phone-a", "phone-b"], from: "sign-in", to: "channels", do: "Sign in with the QA account." },
    { device: ["phone-a", "phone-b"], from: "channels", to: "thread", do: "Open #general." },
    { device: ["phone-a", "phone-b"], from: "thread", to: "channels", do: "Go back." },
    { device: "phone-a", from: "channels", to: "settings", do: "Open Settings." },
    { device: "phone-a", from: "settings", to: "channels", do: "Close Settings." },
    { device: "phone-a", from: "settings", do: "Switch to the dark theme.", needs: ["!dark"], sets: ["dark"] },
    { device: "phone-a", from: "thread", do: 'Send "hi".', sets: ["message", "~sent"] },
  ],
});

const tests = (): SuiteTest[] => [
  { key: "sign-in-works", title: "Sign-in works", expect: "The channel list.", given: { device: "phone-a", at: "channels", look: "Look at the list." } },
  { key: "send-shows-pending", title: "Sending shows a clock", expect: "A pending clock.", given: { device: "phone-a", at: "thread", facts: ["~sent"], look: "Watch it send." } },
  { key: "message-arrives", title: "It arrives", expect: '"hi" is there.', given: { device: "phone-b", at: "thread", facts: ["message"], look: 'Look for "hi".' } },
  { key: "dark-thread", title: "Dark thread", expect: "All dark.", given: { device: "phone-a", at: "thread", facts: ["dark"] } },
  { key: "by-hand", title: "Checked by hand", expect: "Something." },
];

const suite = (over: Partial<Suite> = {}): Suite => ({ product: { name: "Chat" }, tests: tests(), templates: [], graph: graph(), ...over });
const messages = (s: Suite) => lintGraph(s).map((p) => `${p.level} ${p.path.join(".")}: ${p.message}`);

describe("lintGraph", () => {
  test("a good graph has nothing to say", () => {
    expect(messages(suite())).toEqual([]);
  });

  test("a given with no graph is an error", () => {
    expect(messages(suite({ graph: undefined as never }))).toEqual([
      "error tests.0.given: a given needs the app's graph (graph.yaml) to say what its screens and facts are",
      "error tests.1.given: a given needs the app's graph (graph.yaml) to say what its screens and facts are",
      "error tests.2.given: a given needs the app's graph (graph.yaml) to say what its screens and facts are",
      "error tests.3.given: a given needs the app's graph (graph.yaml) to say what its screens and facts are",
    ]);
  });

  test("unknown roles, screens and facts are named where they are", () => {
    const g = graph();
    g.actions.push({ device: "tablet", from: "thread", do: "Look around." });
    g.actions.push({ device: "phone-a", from: "inbox", do: "Archive it.", needs: ["archived"] });
    const s = suite({ graph: g });
    s.tests[0]!.given = { device: "phone-a", at: "home" };
    expect(messages(s)).toEqual([
      'error graph.actions.7.from: no role "tablet"',
      'error graph.actions.8.from: "inbox" is not a phone screen',
      'error graph.actions.8.needs.0: no fact "archived": declare it under facts',
      'error tests.0.given.at: "home" is not a phone screen',
    ]);
  });

  test("a need written -x and a set written !x are mistakes", () => {
    const g = graph();
    g.actions[5] = { device: "phone-a", from: "settings", do: "Switch to the dark theme.", needs: ["-dark"], sets: ["!dark"] };
    expect(messages(suite({ graph: g }))).toContain('error graph.actions.5.needs.0: "-dark": a need says x or !x (x must be false), not -x');
    expect(messages(suite({ graph: g }))).toContain('error graph.actions.5.sets.0: "!dark": a set says x or -x (makes x false), not !x');
  });

  test("a fact needed but never made true is an error; one never needed is a warning", () => {
    const g = graph();
    g.facts.muted = "The channel is muted";
    g.actions.push({ device: "phone-a", from: "thread", do: "Unmute the channel.", needs: ["muted"] });
    g.facts.pinned = "A message is pinned";
    expect(messages(suite({ graph: g }))).toEqual([
      'error graph.facts.muted: fact "muted" is needed but no action makes it true',
      'warning graph.facts.pinned: fact "pinned" is never needed: drop it, or a test\'s given is missing it',
    ]);
  });

  test("a screen with no way out is a warning", () => {
    const g = graph();
    g.screens.phone!.push("crash");
    g.actions.push({ device: "phone-a", from: "thread", to: "crash", do: "Shake the phone." });
    expect(messages(suite({ graph: g }))).toEqual(['warning graph.roles.phone-a: phone-a can reach "crash" but no action leads out of it']);
  });

  test("a given no start can reach is an error", () => {
    const s = suite();
    // Dark is set only in Settings, and nothing goes from there to a thread with dark on… except back via channels: so break that.
    s.graph!.actions = s.graph!.actions.filter((a) => a.do !== "Close Settings.");
    expect(messages(s)).toContain("error tests.3.given: no start can reach this state: check its screen and facts against the actions");
  });

  test("an action no start can get to do is a warning", () => {
    const g = graph();
    g.facts.pinned = "A message is pinned";
    g.actions.push({ device: "phone-a", from: "thread", do: "Unpin the message.", needs: ["pinned"], sets: ["-pinned"] });
    expect(messages(suite({ graph: g }))).toContain('warning graph.actions.7: "Unpin the message." can never be done: no start gets phone-a to thread with pinned');
  });

  test("an action that does two things is flagged like a step", () => {
    const g = graph();
    g.actions[1]!.do = "Open #general and send a message.";
    expect(messages(suite({ graph: g }))).toEqual(['warning graph.actions.1.do: "and send…": one thing per step — split it into two actions']);
  });
});

describe("generateFlows", () => {
  test("checks every test with a given, from a named start, one device per step", () => {
    const g = generateFlows(suite(), { maxSteps: 25 });
    expect(g.unplaced).toEqual([]);
    expect(g.flows).toHaveLength(1);
    const [flow] = g.flows;
    expect(flow!.precondition).toBe("Both phones signed in, on the channel list.");
    expect(flow!.steps.map((s) => `${s.device}: ${s.kind === "check" ? "✓ " : ""}${s.text}`)).toEqual([
      "Phone A: ✓ Look at the list.",
      "Phone A: Open #general.",
      'Phone A: Send "hi".',
      "Phone A: ✓ Watch it send.",
      "Phone B: Open #general.",
      'Phone B: ✓ Look for "hi".',
      "Phone A: Go back.",
      "Phone A: Open Settings.",
      "Phone A: Switch to the dark theme.",
      "Phone A: Close Settings.",
      "Phone A: Open #general.",
      "Phone A: ✓ Dark thread",
    ]);
    // A check carries the test's expected result and verifies it.
    expect(flow!.steps[0]).toEqual({ kind: "check", text: "Look at the list.", device: "Phone A", expect: "The channel list.", verifies: ["sign-in-works"] });
    // Tests with no given are left to hand-written flows.
    expect(g.flows.flatMap((f) => f.steps.flatMap((s) => s.verifies ?? []))).not.toContain("by-hand");
  });

  test("a fresh fact must be checked straight after the action that sets it", () => {
    const flow = generateFlows(suite(), { maxSteps: 25 }).flows[0]!;
    const i = flow.steps.findIndex((s) => s.verifies?.includes("send-shows-pending"));
    expect(flow.steps[i - 1]!.text).toBe('Send "hi".');
  });

  test("the same suite always gives the same flows", () => {
    expect(generateFlows(suite(), { maxSteps: 6 })).toEqual(generateFlows(suite(), { maxSteps: 6 }));
  });

  test("a short limit splits the work into more flows, none over it", () => {
    const g = generateFlows(suite(), { maxSteps: 6 });
    expect(g.flows.length).toBeGreaterThan(1);
    for (const f of g.flows) expect(f.steps.length).toBeLessThanOrEqual(6);
    expect(g.flows.flatMap((f) => f.steps.flatMap((s) => s.verifies ?? [])).sort()).toEqual(["dark-thread", "message-arrives", "send-shows-pending", "sign-in-works"]);
  });

  test("a test further away than a whole flow may be is reported, not dropped silently", () => {
    const g = generateFlows(suite(), { maxSteps: 2 });
    expect(g.unplaced).toContain("message-arrives");
  });

  test("updating keeps every test in its flow, and fits a new one in", () => {
    const before = generateFlows(suite(), { maxSteps: 6 });
    const s = suite();
    s.tests.push({ key: "b-signs-in", title: "Phone B signs in", expect: "The list.", given: { device: "phone-b", at: "channels" } });
    const after = generateFlows(s, { maxSteps: 6, previous: before.flows });
    const where = (flows: typeof before.flows) => new Map(flows.flatMap((f, i) => f.steps.flatMap((st) => (st.verifies ?? []).map((k) => [k, i] as const))));
    const was = where(before.flows), now = where(after.flows);
    for (const [k, i] of was) expect(now.get(k)).toBe(i);
    expect(now.has("b-signs-in")).toBe(true);
    expect(after.fresh).toBeDefined();
  });

  test("an update never leaves a flow over the limit", () => {
    const before = generateFlows(suite(), { maxSteps: 25 });
    const after = generateFlows(suite(), { maxSteps: 6, previous: before.flows });
    for (const f of after.flows) expect(f.steps.length).toBeLessThanOrEqual(6);
    expect(after.flows.flatMap((f) => f.steps.flatMap((s) => s.verifies ?? [])).sort()).toEqual(["dark-thread", "message-arrives", "send-shows-pending", "sign-in-works"]);
  });

  test("a plan reads back from generated flows", () => {
    const g = generateFlows(suite(), { maxSteps: 6 });
    const plan = planOf(graph(), g.flows);
    expect(plan.map((f) => f.tests)).toEqual(g.flows.map((f) => f.steps.flatMap((s) => s.verifies ?? [])));
    expect(generateFlows(suite(), { maxSteps: 6, previous: g.flows }).flows).toEqual(g.flows);
  });

  test("generated steps are not wording-linted: the wording is fixed in the graph and the tests", () => {
    const s = suite();
    s.tests[2]!.expect = "It shows on both devices.";
    const step = { kind: "check" as const, text: 'Look for "hi".', device: "Phone B", expect: s.tests[2]!.expect, verifies: ["message-arrives"] };
    const flows = [{ key: "flow-1", name: "One", steps: [step] }];
    const lint = (key: string) => lintSuite({ ...s, templates: [{ key, name: "T", flows }] }).filter((p) => p.path[0] === "templates");
    expect(lint("by-hand").map((p) => p.message)).toEqual(['says "both devices": a step happens on one device — split it']);
    expect(lint(GENERATED_TEMPLATE)).toEqual([]);
  });

  test("no graph, no flows", () => {
    expect(generateFlows(suite({ graph: undefined as never })).flows).toEqual([]);
  });
});

describe("explainGiven", () => {
  test("a reachable test: the shortest way there, from the nearest start", () => {
    const e = explainGiven(suite(), "message-arrives");
    expect(e.status).toBe("reachable");
    if (e.status !== "reachable") return;
    expect(e.start).toBe("signed-in");
    expect(e.steps.map((s) => `${s.device}: ${s.text}`)).toEqual(["Phone A: Open #general.", "Phone B: Open #general.", 'Phone A: Send "hi".', 'Phone B: Look for "hi".']);
    expect(e.fromEachStart).toEqual({ "signed-in": 3, "signed-out": 5 });
  });

  test("a screen nothing leads to", () => {
    const s = suite();
    s.graph!.screens.phone!.push("profile");
    s.tests[0]!.given = { device: "phone-a", at: "profile" };
    expect(explainGiven(s, "sign-in-works")).toEqual({ test: "sign-in-works", status: "unreachable", reasons: [
      'from signed-in: phone-a can never get to "profile": no action leads there',
      'from signed-out: phone-a can never get to "profile": no action leads there',
    ] });
  });

  test("a fact nothing reachable sets, naming what would set it", () => {
    const s = suite();
    s.graph!.actions = s.graph!.actions.filter((a) => a.do !== "Open Settings.");
    const e = explainGiven(s, "dark-thread", "signed-in");
    expect(e).toEqual({ test: "dark-thread", status: "unreachable", reasons: ['from signed-in: "dark" can never become true: what sets it ("Switch to the dark theme.") is never possible'] });
  });

  test("a fresh fact checked too far from where it is set", () => {
    const s = suite();
    // Sent from the thread, but checked on the channel list: going back clears "just sent".
    s.tests[1]!.given = { device: "phone-a", at: "channels", facts: ["~sent"] };
    const e = explainGiven(s, "send-shows-pending");
    expect(e.status).toBe("unreachable");
    if (e.status === "unreachable") expect(e.reasons[0]).toContain('"sent" is fresh: it is gone after the next action');
  });

  test("a test with no given has nothing to explain", () => {
    expect(explainGiven(suite(), "by-hand").status).toBe("no-given");
  });
});

describe("storing a graph and a given", () => {
  test("given goes into the stored bag beside tags", () => {
    expect(metadataOf({ tags: ["a"], given: { device: "phone-a", at: "thread" }, metadata: { priority: 1 } }))
      .toEqual({ priority: 1, tags: ["a"], given: { device: "phone-a", at: "thread" } });
  });

  test("a changed graph is a product change", () => {
    const stored: Stored = { product: { name: "Chat", description: "", graph: graph() }, tests: [], templates: [] };
    expect(planSuite(stored, { product: { name: "Chat" }, tests: [], templates: [], graph: graph() }).changes).toEqual([]);
    const g = graph();
    g.actions.pop();
    expect(planSuite(stored, { product: { name: "Chat" }, tests: [], templates: [], graph: g }).changes).toEqual([{ op: "update-product", fields: ["graph"] }]);
  });
});
