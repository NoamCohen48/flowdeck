import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Suite } from "@flowdeck/domain";
import { locate, readFolder, writeFolder } from "./files.ts";
import { localChanges, merge } from "./merge.ts";

const dirs: string[] = [];
const scratch = async () => { const d = await mkdtemp(join(tmpdir(), "flowdeck-cli-")); dirs.push(d); return d; };
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

const suite = (): Suite => ({
  product: { name: "Relay", description: "Team messaging" },
  tests: [
    { key: "message-arrives", title: "A message arrives", expect: "It shows within 2s.\nIn order, with the sender's name.", tags: ["messaging"] },
    { key: "old-thing", title: "Old", expect: "Gone", archived: true },
    { key: "sign-in-works", title: "Sign-in works", expect: "Channel list loads.", metadata: { priority: "high" } },
  ],
  templates: [{
    key: "regression",
    name: "Regression",
    description: "Monthly",
    flows: [
      { key: "sign-in", name: "Sign in", precondition: "Fresh install", estimateMinutes: 5, steps: [
        { kind: "action", text: "Open the app", device: "Pixel 8", after: "The welcome screen" },
        { kind: "check", text: "Look at the list", device: "Pixel 8", expect: "Channels show", verifies: ["sign-in-works"] },
      ] },
      { key: "messaging", name: "Messaging", archived: true, steps: [
        { kind: "check", text: "Look at #general", device: "Laptop", expect: "\"hi\" is there", verifies: ["message-arrives", "old-thing"] },
      ] },
    ],
  }],
});

describe("the folder", () => {
  test("a suite written and read back is the same suite", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const { suite: back, problems } = await readFolder(root);
    expect(problems).toEqual([]);
    expect(back).toEqual(suite());
  });

  test("writing again changes nothing; a removed thing removes its file", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    expect(await writeFolder(root, suite())).toEqual({ written: [], removed: [] });
    const less = suite();
    less.tests.splice(1, 1);
    less.templates = [];
    const { removed } = await writeFolder(root, less);
    expect(removed.sort()).toEqual(["templates/regression/messaging.flow.yaml", "templates/regression/sign-in.flow.yaml", "templates/regression/template.yaml", "tests/old-thing.yaml"]);
    expect(existsSync(join(root, "templates", "regression"))).toBe(false);
  });

  test("a step says do: or check:, and an unknown field is an error, not ignored", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    const file = join(root, "templates/regression/sign-in.flow.yaml");
    expect(await readFile(file, "utf8")).toContain("  - do: Open the app\n    device: Pixel 8\n");
    await writeFile(file, "name: Sign in\nsteps:\n  - do: Open the app\n    devices: Pixel 8\n  - tap: Sign in\n    device: Pixel 8\n");
    const { problems } = await readFolder(root);
    expect(problems.map((p) => p.message)).toEqual([
      'step 1: unknown field "devices" (expected one of: do, check, device, expect, after, verifies)',
      'step 1: needs "device"',
      'step 2: unknown field "tap" (expected one of: do, check, device, expect, after, verifies)',
      'step 2: needs exactly one of "do:" (something to do) or "check:" (something to look at)',
    ]);
  });

  test("a flow file template.yaml does not list goes last, with a warning; a listed one that is missing is an error", async () => {
    const root = await scratch();
    await writeFolder(root, suite());
    await writeFile(join(root, "templates/regression/template.yaml"), "name: Regression\nflows: [messaging, gone]\n");
    const { suite: back, problems } = await readFolder(root);
    expect(back.templates[0]!.flows.map((f) => f.key)).toEqual(["messaging", "sign-in"]);
    expect(problems.map((p) => p.level)).toEqual(["error", "warning"]);
  });

  test("lint paths point at the file and the step", () => {
    expect(locate(suite(), ["templates", 0, "flows", 1, "steps", 0, "text"])).toBe("templates/regression/messaging.flow.yaml step 1");
    expect(locate(suite(), ["tests", 2, "expect"])).toBe("tests/sign-in-works.yaml");
  });
});

describe("status and pull", () => {
  test("status sees only what changed locally", () => {
    const local = suite();
    local.tests[0]!.title = "A message arrives on the other device";
    local.templates[0]!.flows[0]!.steps.push({ kind: "action", text: "Sign out", device: "Pixel 8" });
    expect(localChanges(suite(), suite())).toEqual([]);
    expect(localChanges(suite(), local).map((c) => c.op)).toEqual(["update-test", "update-flow"]);
  });

  test("pull keeps your edits, takes theirs, and names what both changed", () => {
    const base = suite();
    const local = suite();
    const remote = suite();
    local.tests[0]!.title = "Mine";                        // only mine
    remote.tests[2]!.title = "Theirs";                     // only theirs
    local.templates[0]!.flows[0]!.name = "Sign in (mine)"; // both, differently
    remote.templates[0]!.flows[0]!.name = "Sign in (theirs)";
    remote.tests.push({ key: "new-from-app", title: "New", expect: "Seen" });
    const m = merge(base, local, remote);
    expect(Object.fromEntries(m.suite.tests.map((t) => [t.key, t.title]))).toEqual({ "message-arrives": "Mine", "new-from-app": "New", "old-thing": "Old", "sign-in-works": "Theirs" });
    expect(m.suite.templates[0]!.flows[0]!.name).toBe("Sign in (mine)");
    expect(m.conflicts).toEqual(["flow regression/sign-in"]);
    expect(m.kept).toEqual(["test message-arrives"]);
    expect(m.taken.sort()).toEqual(["test new-from-app", "test sign-in-works"]);
  });

  test("a file you deleted stays deleted unless the server changed it meanwhile", () => {
    const local = suite();
    local.tests = local.tests.filter((t) => t.key !== "old-thing");
    for (const f of local.templates[0]!.flows) for (const s of f.steps) if (s.verifies) s.verifies = s.verifies.filter((k) => k !== "old-thing");
    const m = merge(suite(), local, suite());
    expect(m.suite.tests.map((t) => t.key)).not.toContain("old-thing");
  });
});
