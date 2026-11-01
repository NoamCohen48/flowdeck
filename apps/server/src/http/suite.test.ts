/**
 * The suite routes against a scratch product: pull, plan, push, and the rules a
 * push follows — keys match, what is left out is archived, an edit is a new
 * version, a surviving step keeps its id, a stale base is refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Suite } from "@flowdeck/domain";
import { withActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { sql } from "../db/client.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

const json = (method: string, body?: unknown, actor: string | null = "suite-agent"): RequestInit => ({
  method,
  headers: { "content-type": "application/json", ...(actor ? { "x-flowdeck-actor": actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Doc = { revision: string; suite: Suite };
type Pushed = { revision: string; previousRevision: string; summary: string[]; problems: { level: string; message: string }[] };

const slug = `suite-test-${Date.now()}`;
let productId: string;

const pull = async () => (await call<Doc>(`/api/products/${slug}/suite`)).body;
const push = (suite: Suite, baseRevision?: string, force = false) =>
  call<Pushed & { error?: string; details?: unknown }>(`/api/products/${slug}/suite`, json("PUT", { suite, baseRevision, force }));

const suite = (): Suite => ({
  product: { name: "Suite scratch" },
  tests: [
    { key: "sign-in-works", title: "Sign-in works", expect: "The channel list loads.", tags: ["auth"] },
    { key: "message-arrives", title: "A message arrives", expect: "It shows on the other device within a second." },
  ],
  templates: [{
    key: "regression",
    name: "Regression",
    flows: [{
      key: "messaging",
      name: "Messaging across two devices",
      estimateMinutes: 10,
      steps: [
        { kind: "action", text: "Sign in", device: "Phone", after: "The channel list" },
        { kind: "check", text: "Look at the header", device: "Phone", expect: "The workspace name is shown.", verifies: ["sign-in-works"] },
        { kind: "action", text: "Send \"hello\" in #general", device: "Phone" },
        { kind: "check", text: "Look at #general", device: "Laptop", expect: "\"hello\" is there.", verifies: ["message-arrives"] },
      ],
    }],
  }],
});

const stepIds = async () => {
  const [tpl] = await sql<{ id: string }[]>`select t.id from template t join product p on p.id = t.product_id where p.slug = ${slug}`;
  const rows = await sql<{ id: string; text: string }[]>`
    select s.id, s.text from step s join flow f on f.id = s.flow_id where f.template_id = ${tpl!.id} order by s.position`;
  return rows;
};

beforeAll(async () => {
  const p = await call<{ id: string; slug: string }>("/api/products", json("POST", { name: "Suite scratch", slug }));
  expect(p.status).toBe(201);
  expect(p.body.slug).toBe(slug);
  productId = p.body.id;
});

afterAll(async () => {
  await sql`delete from product where id = ${productId}`;
  await sql`delete from actor where name = 'suite-agent'`;
});

describe("the suite document", () => {
  test("a new product's suite is empty, by slug or by id", async () => {
    const bySlug = await pull();
    expect(bySlug.suite).toEqual({ product: { name: "Suite scratch" }, tests: [], templates: [] });
    const byId = (await call<Doc>(`/api/products/${productId}/suite`)).body;
    expect(byId.revision).toBe(bySlug.revision);
  });

  test("a plan says what would change and changes nothing", async () => {
    const before = await pull();
    const plan = await call<{ revision: string; summary: string[] }>(`/api/products/${slug}/suite/plan`, json("POST", suite()));
    expect(plan.status).toBe(200);
    expect(plan.body.revision).toBe(before.revision);
    expect(plan.body.summary).toEqual(["+ test sign-in-works", "+ test message-arrives", "+ template regression", "+ flow regression/messaging"]);
    expect((await pull()).revision).toBe(before.revision);
  });

  test("a push creates it, and pulling gives back what was pushed", async () => {
    const base = (await pull()).revision;
    const res = await push(suite(), base);
    expect(res.status).toBe(200);
    expect(res.body.previousRevision).toBe(base);
    expect(res.body.revision).not.toBe(base);

    const back = await pull();
    expect(back.revision).toBe(res.body.revision);
    const expected = suite();
    // Tests come back sorted by key, verifies sorted; everything else as sent.
    expect(back.suite.tests.map((t) => t.key)).toEqual(["message-arrives", "sign-in-works"]);
    expect(back.suite.templates).toEqual(expected.templates);
    expect(back.suite.tests.find((t) => t.key === "sign-in-works")).toEqual(expected.tests[0]!);
  });

  test("pushing what was pulled changes nothing and keeps the revision", async () => {
    const doc = await pull();
    const res = await push(doc.suite, doc.revision);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual([]);
    expect(res.body.revision).toBe(doc.revision);
  });

  test("a push from a stale base is refused, unless forced", async () => {
    const doc = await pull();
    const res = await push(doc.suite, "000000000000");
    expect(res.status).toBe(409);
    expect((res.body as unknown as { revision: string }).revision).toBe(doc.revision);
    expect((await push(doc.suite, undefined, true)).status).toBe(200);
  });

  test("a push names its base or says force", async () => {
    expect((await push(suite())).status).toBe(400);
  });

  test("a push needs an identity", async () => {
    const res = await call(`/api/products/${slug}/suite`, json("PUT", { suite: suite(), force: true }, null));
    expect(res.status).toBe(401);
  });

  test("errors are refused by path; warnings are returned and allowed", async () => {
    const bad = suite();
    bad.templates[0]!.flows[0]!.steps[1]!.verifies = ["no-such-test"];
    const res = await push(bad, (await pull()).revision);
    expect(res.status).toBe(400);
    expect((res.body.details as { level: string; path: unknown[]; message: string }[]).filter((p) => p.level === "error")).toEqual([{ level: "error", path: ["templates", 0, "flows", 0, "steps", 1, "verifies", 0], message: 'no test "no-such-test": create it, or take it out of verifies' }]);

    const warned = suite();
    warned.templates[0]!.flows[0]!.steps[0]!.text = "Open the app and sign in";
    const ok = await push(warned, (await pull()).revision);
    expect(ok.status).toBe(200);
    expect(ok.body.problems.map((p) => p.level)).toEqual(["warning"]);
    expect(ok.body.problems[0]!.message).toContain("one thing per step");
  });

  test("an edited test gets a new version, and the old one stays", async () => {
    const doc = await pull();
    const t = doc.suite.tests.find((x) => x.key === "sign-in-works")!;
    t.expect = "The channel list loads within 3 seconds.";
    const res = await push(doc.suite, doc.revision);
    expect(res.body.summary).toEqual(["~ test sign-in-works: expect (new version)"]);
    const versions = await sql<{ version: number; expected_result: string; created_by: string }[]>`
      select v.version, v.expected_result, v.created_by from test_version v join test t on t.id = v.test_id
      where t.product_id = ${productId} and t.key = 'sign-in-works' order by v.version`;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.expected_result).toBe("The channel list loads.");
    expect(versions[1]!.created_by).toBe("suite-agent");
  });

  test("a step that survives an edit keeps its id", async () => {
    const before = await stepIds();
    const doc = await pull();
    const steps = doc.suite.templates[0]!.flows[0]!.steps;
    steps.splice(2, 0, { kind: "action", text: "Open #general", device: "Phone" });
    steps[1]!.text = "Look at the header bar";
    const res = await push(doc.suite, doc.revision);
    expect(res.body.summary).toEqual(["~ flow regression/messaging: steps (1 added, 1 edited)"]);
    const after = await stepIds();
    expect(after.map((s) => s.text)).toEqual(["Open the app and sign in", "Look at the header bar", "Open #general", "Send \"hello\" in #general", "Look at #general"]);
    expect([after[0]!.id, after[1]!.id, after[3]!.id, after[4]!.id]).toEqual(before.map((s) => s.id));
  });

  test("what a push leaves out is archived, and pushing it back restores it", async () => {
    const doc = await pull();
    const withoutTest = structuredClone(doc.suite);
    withoutTest.tests = withoutTest.tests.filter((t) => t.key !== "message-arrives");
    for (const s of withoutTest.templates[0]!.flows[0]!.steps) s.verifies = s.verifies?.filter((k) => k !== "message-arrives");
    withoutTest.templates[0]!.flows[0]!.steps = withoutTest.templates[0]!.flows[0]!.steps.map(({ verifies, ...s }) => (verifies?.length ? { ...s, verifies } : s));
    const res = await push(withoutTest, doc.revision);
    expect(res.body.summary).toEqual(["- test message-arrives (archived)", "~ flow regression/messaging: steps (1 edited)"]);
    const [row] = await sql<{ archived: boolean }[]>`select archived from test where product_id = ${productId} and key = 'message-arrives'`;
    expect(row!.archived).toBe(true);
    expect((await pull()).suite.tests.map((t) => t.key)).toEqual(["sign-in-works"]);

    const back = await push(doc.suite, res.body.revision);
    expect(back.body.summary).toEqual(["+ test message-arrives (restored)", "~ flow regression/messaging: steps (1 edited)"]);
    expect((await pull()).revision).toBe(doc.revision);
  });

  test("the download names the file after the slug", async () => {
    const res = await app.request(`/api/products/${slug}/suite?download=true`);
    expect(res.headers.get("content-disposition")).toContain(`${slug}-`);
  });
});

describe("keys elsewhere", () => {
  test("creating a test without a key makes one from the title; a taken key is a 409", async () => {
    const made = await call<{ key: string }[]>(`/api/products/${productId}/tests`, json("POST", { tests: [{ title: "Sign-in works", expectedResult: "Again" }] }));
    expect(made.status).toBe(201);
    expect(made.body[0]!.key).toBe("sign-in-works-2");
    const taken = await call(`/api/products/${productId}/tests`, json("POST", { tests: [{ key: "sign-in-works", title: "X", expectedResult: "Y" }] }));
    expect(taken.status).toBe(409);
  });

  test("a product slug that is taken is a 409", async () => {
    const res = await call("/api/products", json("POST", { name: "Another", slug }));
    expect(res.status).toBe(409);
  });
});
