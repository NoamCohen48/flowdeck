import { describe, expect, test } from "bun:test";
import type { Suite } from "./suite.ts";
import { describeChange, matchSteps, planSuite, type Stored, type StoredStep } from "./suite-plan.ts";

const st = (id: string, text: string, device = "Phone", kind: "action" | "check" = "action"): StoredStep => ({
  id, kind, text, device, expect: kind === "check" ? "Seen" : null, after: null, verifies: [],
});
const want = (text: string, device = "Phone", kind: "action" | "check" = "action") => ({ kind, text, device });

describe("matchSteps keeps the ids of steps that survive", () => {
  const stored = [st("a", "Open the app"), st("b", "Sign in"), st("c", "Open the chat"), st("d", "Send hello")];

  test("an untouched flow keeps every id", () => {
    const m = matchSteps(stored, stored);
    expect(m.ids).toEqual(["a", "b", "c", "d"]);
    expect(m.counts).toEqual({ added: 0, removed: 0, edited: 0, moved: 0 });
  });

  test("an inserted step is new; the rest keep their ids", () => {
    const m = matchSteps(stored, [want("Open the app"), want("Dismiss the tour"), want("Sign in"), want("Open the chat"), want("Send hello")]);
    expect(m.ids).toEqual(["a", null, "b", "c", "d"]);
    expect(m.counts.added).toBe(1);
  });

  test("a removed step is removed, not shifted onto its neighbour", () => {
    const m = matchSteps(stored, [want("Open the app"), want("Open the chat"), want("Send hello")]);
    expect(m.ids).toEqual(["a", "c", "d"]);
    expect(m.removed).toEqual(["b"]);
  });

  test("a reworded step stays the same step, as an edit", () => {
    const m = matchSteps(stored, [want("Open the app"), want("Sign in with the test account"), want("Open the chat"), want("Send hello")]);
    expect(m.ids).toEqual(["a", "b", "c", "d"]);
    expect(m.counts).toEqual({ added: 0, removed: 0, edited: 1, moved: 0 });
  });

  test("a moved step keeps its id", () => {
    const m = matchSteps(stored, [want("Sign in"), want("Open the app"), want("Open the chat"), want("Send hello")]);
    expect(new Set(m.ids)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(m.counts.moved).toBe(1);
    expect(m.removed).toEqual([]);
  });

  test("the same text on another device is a different step", () => {
    const m = matchSteps([st("a", "Open the chat", "Phone")], [want("Open the chat", "Laptop"), want("Open the chat", "Phone")]);
    expect(m.ids).toEqual([null, "a"]);
  });
});

const stored: Stored = {
  product: { name: "Relay", description: "" },
  tests: [
    { id: "t1", key: "sign-in-works", title: "Sign-in works", expect: "The channel list loads.", metadata: { tags: ["auth"] }, archived: false },
    { id: "t2", key: "message-arrives", title: "A message arrives", expect: "It shows within a second.", metadata: {}, archived: false },
  ],
  templates: [{
    id: "tp", key: "regression", name: "Regression", description: "", archived: false,
    flows: [
      { id: "f1", key: "first-run", name: "First run", precondition: "", estimateMinutes: 10, archived: false, steps: [
        { ...st("s1", "Sign in"), verifies: [] },
        { ...st("s2", "Look at the channel list", "Phone", "check"), verifies: ["t1"] },
      ] },
      { id: "f2", key: "messaging", name: "Messaging", precondition: "", estimateMinutes: null, archived: false, steps: [
        { ...st("s3", "Look at the chat", "Laptop", "check"), verifies: ["t2"] },
      ] },
    ],
  }],
};

/** The desired suite that says exactly what `stored` holds. */
const same = (): Suite => ({
  product: { name: "Relay" },
  tests: [
    { key: "sign-in-works", title: "Sign-in works", expect: "The channel list loads.", tags: ["auth"] },
    { key: "message-arrives", title: "A message arrives", expect: "It shows within a second." },
  ],
  templates: [{
    key: "regression", name: "Regression",
    flows: [
      { key: "first-run", name: "First run", estimateMinutes: 10, steps: [
        { kind: "action", text: "Sign in", device: "Phone" },
        { kind: "check", text: "Look at the channel list", device: "Phone", expect: "Seen", verifies: ["sign-in-works"] },
      ] },
      { key: "messaging", name: "Messaging", steps: [
        { kind: "check", text: "Look at the chat", device: "Laptop", expect: "Seen", verifies: ["message-arrives"] },
      ] },
    ],
  }],
});

describe("planSuite", () => {
  test("the suite as stored changes nothing", () => {
    expect(planSuite(stored, same()).changes).toEqual([]);
  });

  test("whitespace alone is not a change", () => {
    const s = same();
    s.tests[0]!.title = "  Sign-in works ";
    expect(planSuite(stored, s).changes).toEqual([]);
  });

  test("a new key is created, and its flow with it", () => {
    const s = same();
    s.tests.push({ key: "reaction-shows", title: "A reaction shows", expect: "The count goes up." });
    s.templates[0]!.flows.push({ key: "reactions", name: "Reactions", steps: [] });
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual(["+ test reaction-shows", "+ flow regression/reactions"]);
  });

  test("an edited test is a new version; a retagged one too", () => {
    const s = same();
    s.tests[0]!.expect = "The channel list loads within 3 seconds.";
    s.tests[1]!.tags = ["messaging"];
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual([
      "~ test sign-in-works: expect (new version)",
      "~ test message-arrives: metadata (new version)",
    ]);
  });

  test("whatever is left out is archived, never deleted", () => {
    const s = same();
    s.tests.splice(1, 1);
    s.templates[0]!.flows.splice(1, 1);
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual([
      "- test message-arrives (archived)",
      "- flow regression/messaging (archived)",
    ]);
    const noTemplate = { ...same(), templates: [] };
    expect(planSuite(stored, noTemplate).changes.map(describeChange)).toEqual(["- template regression (archived)"]);
  });

  test("flows in a new order are a reorder", () => {
    const s = same();
    s.templates[0]!.flows.reverse();
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual(["~ template regression: flow order"]);
  });

  test("step edits are counted", () => {
    const s = same();
    const steps = s.templates[0]!.flows[0]!.steps;
    steps.splice(1, 0, { kind: "action", text: "Dismiss the tour", device: "Phone" });
    steps[0]!.after = "The home screen";
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual(["~ flow regression/first-run: steps (1 added, 1 edited)"]);
  });

  test("a step that now verifies something else is an edit", () => {
    const s = same();
    s.templates[0]!.flows[1]!.steps[0]!.verifies = ["message-arrives", "sign-in-works"];
    expect(planSuite(stored, s).changes.map(describeChange)).toEqual(["~ flow regression/messaging: steps (1 edited)"]);
  });
});
