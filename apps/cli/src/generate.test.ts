import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Suite } from "@flowdeck/domain";
import { readFolder, writeFolder } from "./files.ts";

const dirs: string[] = [];
const scratch = async () => { const d = await mkdtemp(join(tmpdir(), "flowdeck-gen-")); dirs.push(d); return d; };
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

const MAIN = join(import.meta.dir, "main.ts");
async function flowdeck(root: string, ...args: string[]) {
  const p = Bun.spawn(["bun", MAIN, ...args, "--dir", root], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
  return { out, err, code };
}

const suite = (): Suite => ({
  product: { name: "Chat" },
  tests: [
    { key: "dark-thread", title: "The thread is dark in dark mode", expect: "Nothing light.", given: { device: "phone-a", at: "thread", facts: ["dark"] } },
    { key: "message-arrives", title: "A message arrives", expect: '"hi" is there.', given: { device: "phone-b", at: "thread", facts: ["message"], look: 'Look for "hi".' } },
    { key: "send-shows-pending", title: "Sending shows a clock", expect: "A pending clock.", given: { device: "phone-a", at: "thread", facts: ["~sent"], look: "Watch it send." } },
  ],
  templates: [],
  graph: {
    roles: { "phone-a": { name: "Phone A", surface: "phone" }, "phone-b": { name: "Phone B", surface: "phone" } },
    screens: { phone: ["channels", "thread", "settings"] },
    facts: { message: "A message is in #general", dark: "Dark theme is on", "~sent": "Just sent" },
    starts: { "signed-in": { say: "Both phones signed in, on the channel list.", at: { "phone-a": "channels", "phone-b": "channels" } } },
    actions: [
      { device: ["phone-a", "phone-b"], from: "channels", to: "thread", do: "Open #general." },
      { device: ["phone-a", "phone-b"], from: "thread", to: "channels", do: "Go back." },
      { device: "phone-a", from: "channels", to: "settings", do: "Open Settings." },
      { device: "phone-a", from: "settings", to: "channels", do: "Close Settings." },
      { device: "phone-a", from: "settings", do: "Switch to the dark theme.", needs: ["!dark"], sets: ["dark"] },
      { device: "phone-a", from: "thread", do: 'Send "hi".', sets: ["message", "~sent"] },
    ],
  },
});

describe("flowdeck generate", () => {
  test("writes templates/generated/ that lints clean, and a second run changes nothing", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const first = await flowdeck(root, "generate");
    expect(first.code).toBe(0);
    expect(first.out).toContain("1 flow, 11 steps, 3 tests (at most 25 steps a flow).");
    expect(first.out).not.toContain("New:");
    expect(existsSync(join(root, "templates/generated/flow-1.flow.yaml"))).toBe(true);
    expect(await readFile(join(root, "templates/generated/flow-1.flow.yaml"), "utf8")).toContain("precondition: Both phones signed in, on the channel list.\n");

    const { suite: back, problems } = await readFolder(root);
    expect(problems).toEqual([]);
    expect(back.templates[0]!.description).toContain("edits made here are overwritten");
    expect((await flowdeck(root, "lint")).code).toBe(0);

    const again = await flowdeck(root, "generate");
    expect(again.out).toContain("templates/generated is already up to date.");
  });

  test("--max splits the flows; an update keeps tests where they were", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const split = JSON.parse((await flowdeck(root, "generate", "--max", "6", "--json")).out);
    expect(split.flows.length).toBeGreaterThan(1);
    for (const f of split.flows) expect(f.steps).toBeLessThanOrEqual(6);

    const s = (await readFolder(root)).suite;
    s.tests.push({ key: "b-in-thread", title: "Phone B sees the thread", expect: "The thread.", given: { device: "phone-b", at: "thread" } });
    await writeFolder(root, s);
    const updated = JSON.parse((await flowdeck(root, "generate", "--max", "6", "--json")).out);
    expect(updated.moved).toEqual([]);
    expect(updated.added).toEqual(["b-in-thread"]);
  });

  test("errors stop it; so does a missing graph or a bad --max", async () => {
    const root = await scratch();
    const bad = suite();
    bad.tests[0]!.given = { device: "phone-a", at: "nowhere" };
    await writeFolder(root, bad);
    const refused = await flowdeck(root, "generate");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('tests/dark-thread.yaml: "nowhere" is not a phone screen');
    expect(existsSync(join(root, "templates/generated"))).toBe(false);

    await writeFolder(root, suite());
    expect((await flowdeck(root, "generate", "--max", "zero")).code).toBe(2);
    await rm(join(root, "graph.yaml"));
    for (const t of ["dark-thread", "message-arrives", "send-shows-pending"]) await writeFile(join(root, `tests/${t}.yaml`), "title: T\nexpect: E\n");
    const none = await flowdeck(root, "generate");
    expect(none.code).toBe(2);
    expect(none.err).toContain("no graph.yaml here");
  });
});

describe("flowdeck graph", () => {
  test("show lists each role's screens, the ways out and the tests checked there", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const { out, code } = await flowdeck(root, "graph", "show");
    expect(code).toBe(0);
    expect(out).toContain("phone-a: Phone A, on phone\n  channels   [start: signed-in]\n    → thread  Open #general.\n");
    expect(out).toContain('    (stays)  Send "hi".   (sets message, ~sent)\n');
    expect(out).toContain("    ✓ send-shows-pending   (with ~sent)\n");
  });

  test("explain gives the shortest way to a test, or why there is none", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const ok = await flowdeck(root, "graph", "explain", "message-arrives");
    expect(ok.out).toContain("message-arrives: 3 steps from signed-in");
    expect(ok.out).toContain('   4. [Phone B] ✓ Look for "hi".');

    const s = suite();
    s.tests[0]!.given = { device: "phone-a", at: "channels", facts: ["dark", "~sent"] };
    await writeFolder(root, s);
    expect((await flowdeck(root, "lint")).code).toBe(1);
    const bad = await flowdeck(root, "graph", "explain", "dark-thread");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("dark-thread cannot be reached:\n");
    expect(bad.out).toContain('"sent" is fresh');
  });

  test("mermaid draws one box per role", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const { out } = await flowdeck(root, "graph", "mermaid");
    expect(out.split("\n")[0]).toBe("flowchart LR");
    expect(out).toContain('  subgraph phone_a__["Phone A"]');
    expect(out).toContain('  phone_a__settings -->|"Switch to the dark theme.<br/>if !dark, sets dark"| phone_a__settings');
  });
});

describe("graph lint and setup", () => {
  test("a problem in graph.yaml names its line", async () => {
    const root = await scratch();
    const s = suite();
    s.graph!.actions[2]!.from = "nowhere";
    await writeFolder(root, s);
    const text = await readFile(join(root, "graph.yaml"), "utf8");
    const line = text.split("\n").findIndex((l) => l.includes("from: nowhere")) + 1;
    const { out } = await flowdeck(root, "lint");
    expect(out).toMatch(new RegExp(`graph\\.yaml:(${line - 2}|${line - 1}) action 3: "nowhere" is not a phone screen`));
  });

  test("--keep-setup keeps the steps that only get to the first test", async () => {
    const root = await scratch();
    const s = suite();
    // From signed out, four actions to get both phones into place; only the last is about the check.
    s.graph!.screens.phone!.push("sign-in");
    s.graph!.starts = { "signed-out": { say: "Both phones signed out.", at: { "phone-a": "sign-in", "phone-b": "sign-in" } } };
    s.graph!.actions.push({ device: ["phone-a", "phone-b"], from: "sign-in", to: "channels", do: "Sign in." });
    s.tests = [{ key: "both-placed", title: "Both in place", expect: "Yes.", given: { device: "phone-a", at: "settings", also: { "phone-b": "thread" } } }];
    await writeFolder(root, s);
    await flowdeck(root, "generate");
    const folded = await readFile(join(root, "templates/generated/flow-1.flow.yaml"), "utf8");
    // Three of the four actions fold into the precondition; the last stays, right before the check.
    expect(folded).toContain("Then, any way you like: Phone A is on ");
    expect(folded.match(/ {2}- do: /g)).toHaveLength(1);
    await flowdeck(root, "generate", "--replan", "--keep-setup");
    const kept = await readFile(join(root, "templates/generated/flow-1.flow.yaml"), "utf8");
    expect(kept).not.toContain("any way you like");
    expect(kept).toContain("do: Sign in.");
  });
});
