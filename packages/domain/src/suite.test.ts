import { describe, expect, test } from "bun:test";
import { joinsSeveralActions, lintSuite, slugify, uniqueKey, type Suite } from "./suite.ts";

const suite = (over: Partial<Suite> = {}): Suite => ({
  product: { name: "Relay" },
  tests: [
    { key: "optimistic-send", title: "Sending shows it optimistically", expect: "A pending clock, then a check." },
    { key: "reaction-sync", title: "Reactions sync", expect: "Same emoji and count on both." },
  ],
  templates: [{
    key: "monthly",
    name: "Monthly",
    flows: [{
      key: "messaging",
      name: "Messaging",
      steps: [
        { kind: "action", text: "Open the chat.", device: "Pixel 8" },
        { kind: "check", text: "Watch the message.", device: "Pixel 8", expect: "Clock, then check.", verifies: ["optimistic-send"] },
        { kind: "check", text: "Look at the reaction.", device: "iPhone 13", expect: "Same count.", verifies: ["reaction-sync"] },
      ],
    }],
  }],
  ...over,
});

const messages = (s: Suite) => lintSuite(s).map((p) => `${p.level}: ${p.message}`);

describe("keys", () => {
  test("slugify keeps words, drops punctuation and accents, caps at a word boundary", () => {
    expect(slugify("Sending a message — shows it *optimistically*!")).toBe("sending-a-message-shows-it-optimistically");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("שלום", "test")).toBe("test");
    expect(slugify("word ".repeat(40)).length).toBeLessThanOrEqual(64);
  });

  test("uniqueKey numbers a clash", () => {
    expect(uniqueKey("a", new Set(["a", "a-2"]))).toBe("a-3");
    expect(uniqueKey("b", new Set(["a"]))).toBe("b");
  });
});

describe("lintSuite", () => {
  test("a clean suite has no problems", () => {
    expect(lintSuite(suite())).toEqual([]);
  });

  test("a step verifying a test that does not exist is an error, with its path", () => {
    const s = suite();
    const bad: Suite = { ...s, templates: [{ ...s.templates[0]!, flows: [{ ...s.templates[0]!.flows[0]!, steps: [{ kind: "check", text: "Look.", device: "Pixel 8", expect: "x", verifies: ["nope"] }] }] }] };
    const problems = lintSuite(bad);
    expect(problems.find((p) => p.level === "error")).toMatchObject({ path: ["templates", 0, "flows", 0, "steps", 0, "verifies", 0], message: 'no test "nope": create it, or take it out of verifies' });
  });

  test("duplicate and malformed keys are errors", () => {
    const s = suite({ tests: [
      { key: "Bad Key", title: "x", expect: "y" },
      { key: "dup", title: "x", expect: "y" },
      { key: "dup", title: "x", expect: "y" },
    ] });
    const errors = lintSuite(s).filter((p) => p.level === "error").map((p) => p.message);
    expect(errors.some((m) => m.includes("is not a key"))).toBe(true);
    expect(errors.some((m) => m.includes("defined twice"))).toBe(true);
  });

  test("an uncovered test warns, it does not block", () => {
    const s = suite({ tests: [...suite().tests, { key: "lonely", title: "x", expect: "y" }] });
    expect(messages(s)).toContain('warning: "lonely" is in no flow: it will never be checked on a testing day');
  });

  test("one device per step, one thing per step, near-duplicate devices", () => {
    const s = suite();
    const flow = s.templates[0]!.flows[0]!;
    const steps = [
      ...flow.steps,
      { kind: "check" as const, text: "Check the iPhone 13 and the Pixel 8.", device: "iPhone 13", expect: "Both show it." },
      { kind: "action" as const, text: "Open the chat and send hello.", device: "pixel  8" },
    ];
    const m = messages({ ...s, templates: [{ ...s.templates[0]!, flows: [{ ...flow, steps }] }] });
    expect(m.some((x) => x.includes("also names Pixel 8"))).toBe(true);
    expect(m.some((x) => x.includes('"and send…": one thing per step'))).toBe(true);
    expect(m.some((x) => x.includes('"pixel  8" looks like "Pixel 8"'))).toBe(true);
  });
});

describe("joinsSeveralActions", () => {
  test("flags a second instruction, not a list of nouns", () => {
    expect(joinsSeveralActions("Open the chat and send hello.")).toBe("and send");
    expect(joinsSeveralActions("Open settings, tap Appearance.")).toBe(", tap");
    expect(joinsSeveralActions("Go back, then open settings")).toBe(", then open");
    expect(joinsSeveralActions("Compare the reaction and its count.")).toBeUndefined();
    expect(joinsSeveralActions("As Dana, send \"wake up\".")).toBeUndefined();
    expect(joinsSeveralActions("On the laptop, open the chat and send hi.")).toBe("and send");
    expect(joinsSeveralActions("Check that the header and footer render.")).toBeUndefined();
  });
});

describe("two sentences, two steps", () => {
  test("a second sentence that starts with an instruction is a second step", () => {
    expect(joinsSeveralActions("Turn off airplane mode. Wait up to 30 seconds.")).toBe(". Wait");
    expect(joinsSeveralActions("Hold the tablet in landscape. Look at the screen.")).toBe(". Look");
    expect(joinsSeveralActions("The list loads. It shows three rows.")).toBeUndefined();
  });
});
