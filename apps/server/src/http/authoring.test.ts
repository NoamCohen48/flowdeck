/**
 * Structural editing against the seeded database: insert anywhere, reorder,
 * last-write-wins per step, marks, and the derived hand-offs following a move.
 * Everything runs in a scratch template so the seeded testing day is untouched.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, setActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { sql } from "../db/client.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

async function cookieFor(name: string) {
  const probe = new Hono<ActorEnv>();
  probe.get("/", async (c) => {
    await setActor(c, name);
    return c.text("ok");
  });
  const res = (await probe.request("/")) as Response;
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

let noa: string;
const req = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json", cookie: noa },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Step = { id: string; position: number; kind: string; text: string; expectedResult: string | null; deviceLabel: string; marks: string[] };
type Flow = { id: string; name: string; position: number; steps: Step[] };
type Template = { id: string; name: string; status: string; flows: Flow[] };
type Device = { label: string; letter: string; introducedAtIndex: number };

let productId: string;
let tests: string[];
let template: Template;
let flow: Flow;

const stepInput = (text: string, deviceLabel: string, position: number, extra: Partial<Step> = {}) => ({
  position, kind: "action", text, expectedResult: null, deviceLabel, marks: [], ...extra,
});

async function steps(): Promise<Step[]> {
  const tpl = (await call<Template>(`/api/templates/${template.id}`)).body;
  return tpl.flows.find((f) => f.id === flow.id)!.steps;
}

async function devices(): Promise<Device[]> {
  return (await call<{ devices: Device[] }>(`/api/flows/${flow.id}/devices`)).body.devices;
}

beforeAll(async () => {
  noa = await cookieFor("Noa");
  const products = (await call<{ id: string; name: string }[]>("/api/products")).body;
  productId = products.find((p) => p.name === "Relay")!.id;
  tests = (await call<{ id: string }[]>(`/api/products/${productId}/tests`)).body.slice(0, 3).map((t) => t.id);

  const created = await call<Template[]>(`/api/products/${productId}/templates`, req("POST", {
    templates: [{
      name: `Editor scratch ${Date.now()}`,
      flows: [{
        name: "Drafting",
        steps: [
          { kind: "action", text: "Open the app", deviceLabel: "Pixel 8" },
          { kind: "action", text: "Sign in", deviceLabel: "Pixel 8", marks: [tests[0]] },
          { kind: "assertion", text: "Compare on the tablet", expectedResult: "Same", deviceLabel: "Galaxy Tab", marks: [tests[1]] },
        ],
      }],
    }],
  }));
  expect(created.status).toBe(201);
  template = created.body[0]!;
  flow = template.flows[0]!;
});

// The scratch template has no runs, so a plain delete cascades cleanly and the
// seeded product is left exactly as the seed made it.
afterAll(async () => {
  if (template) await sql`delete from template where id = ${template.id}`;
});

describe("insert anywhere (07 §1)", () => {
  test("a step inserted between two others takes the slot and shifts the rest", async () => {
    const res = await call<{ step: Step; txid: number }>(`/api/flows/${flow.id}/steps`, req("POST", stepInput("Dismiss the tour", "Pixel 8", 1)));
    expect(res.status).toBe(201);
    expect(res.body.step.position).toBe(1);
    expect(res.body.txid).toBeGreaterThan(0);

    const now = await steps();
    expect(now.map((s) => s.text)).toEqual(["Open the app", "Dismiss the tour", "Sign in", "Compare on the tablet"]);
    expect(now.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  test("a position past the end appends", async () => {
    const res = await call<{ step: Step }>(`/api/flows/${flow.id}/steps`, req("POST", stepInput("Sign out", "Pixel 8", 99)));
    expect(res.status).toBe(201);
    expect(res.body.step.position).toBe(4);
  });

  test("an action never carries an expected result", async () => {
    const res = await call<{ step: Step }>(`/api/flows/${flow.id}/steps`, req("POST", stepInput("Tap", "Pixel 8", 99, { expectedResult: "ignored" })));
    expect(res.body.step.expectedResult).toBeNull();
    await call(`/api/steps/${res.body.step.id}`, req("DELETE"));
  });

  test("a mark on an unknown test is a 404, not a 500", async () => {
    const res = await call(`/api/flows/${flow.id}/steps`, req("POST", stepInput("Tap", "Pixel 8", 0, { marks: ["00000000-0000-4000-8000-000000000000"] })));
    expect(res.status).toBe(404);
  });
});

describe("reorder and derived hand-offs", () => {
  test("moving the tablet step to the top moves its introduction with it", async () => {
    const before = await devices();
    expect(before.find((d) => d.label === "Galaxy Tab")!.introducedAtIndex).toBe(3);

    const ids = (await steps()).map((s) => s.id);
    const tablet = ids[3]!;
    const reordered = [tablet, ...ids.filter((id) => id !== tablet)];
    const res = await call<{ txid: number }>(`/api/flows/${flow.id}/steps/order`, req("PUT", { ids: reordered }));
    expect(res.status).toBe(200);
    expect(res.body.txid).toBeGreaterThan(0);

    expect((await steps()).map((s) => s.id)).toEqual(reordered);
    const after = await devices();
    expect(after.find((d) => d.label === "Galaxy Tab")!.introducedAtIndex).toBe(0);
    // Slots follow order of appearance (D39): the tablet is now device A.
    expect(after.find((d) => d.label === "Galaxy Tab")!.letter).toBe("A");
  });

  test("a stale order — not exactly the flow's steps — is refused", async () => {
    const ids = (await steps()).map((s) => s.id);
    const missingOne = await call(`/api/flows/${flow.id}/steps/order`, req("PUT", { ids: ids.slice(1) }));
    expect(missingOne.status).toBe(409);
    const duplicated = await call(`/api/flows/${flow.id}/steps/order`, req("PUT", { ids: [ids[0]!, ids[0]!, ...ids.slice(2)] }));
    expect(duplicated.status).toBe(409);
  });

  test("deleting a step closes the gap", async () => {
    const before = await steps();
    const victim = before[1]!;
    const res = await call<{ txid: number }>(`/api/steps/${victim.id}`, req("DELETE"));
    expect(res.status).toBe(200);
    const after = await steps();
    expect(after).toHaveLength(before.length - 1);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i));
    expect(after.some((s) => s.id === victim.id)).toBe(false);
  });
});

describe("editing one step (D37)", () => {
  test("a patch changes only what it names and stamps the write", async () => {
    const target = (await steps())[1]!;
    const res = await call<{ step: Step }>(`/api/steps/${target.id}`, req("PATCH", { text: "Sign in with the QA account" }));
    expect(res.status).toBe(200);
    expect(res.body.step.text).toBe("Sign in with the QA account");
    expect(res.body.step.deviceLabel).toBe(target.deviceLabel);
    expect(res.body.step.marks).toEqual(target.marks);
  });

  test("turning a check into an action drops its expected result", async () => {
    const check = (await steps()).find((s) => s.kind === "assertion")!;
    const res = await call<{ step: Step }>(`/api/steps/${check.id}`, req("PATCH", { kind: "action" }));
    expect(res.body.step.expectedResult).toBeNull();
    await call(`/api/steps/${check.id}`, req("PATCH", { kind: "assertion", expectedResult: "Same" }));
  });

  test("marks replace as a set when given, and are untouched otherwise", async () => {
    const target = (await steps())[0]!;
    const set = await call<{ step: Step }>(`/api/steps/${target.id}`, req("PATCH", { marks: [tests[1], tests[2]] }));
    expect([...set.body.step.marks].sort()).toEqual([tests[1]!, tests[2]!].sort());
    const untouched = await call<{ step: Step }>(`/api/steps/${target.id}`, req("PATCH", { text: "Still marked" }));
    expect(untouched.body.step.marks).toHaveLength(2);
  });

  test("marking one test at a time is idempotent and shows up in usages", async () => {
    const target = (await steps())[2]!;
    const once = await call<{ txid: number }>(`/api/steps/${target.id}/marks/${tests[2]}`, req("PUT"));
    const twice = await call<{ txid: number }>(`/api/steps/${target.id}/marks/${tests[2]}`, req("PUT"));
    expect(once.status).toBe(200);
    expect(twice.status).toBe(200);

    const usage = await call<{ steps: number; usages: { stepId: string; flowName: string; templateName: string }[] }>(`/api/tests/${tests[2]}/usages`);
    const here = usage.body.usages.filter((u) => u.stepId === target.id);
    expect(here).toHaveLength(1);
    expect(here[0]!.flowName).toBe("Drafting");
    expect(here[0]!.templateName).toBe(template.name);

    await call(`/api/steps/${target.id}/marks/${tests[2]}`, req("DELETE"));
    const again = await call<{ usages: { stepId: string }[] }>(`/api/tests/${tests[2]}/usages`);
    expect(again.body.usages.some((u) => u.stepId === target.id)).toBe(false);
  });
});

describe("flows and templates", () => {
  test("a new flow lands last, can be edited, reordered and deleted", async () => {
    const created = await call<Flow>(`/api/templates/${template.id}/flows`, req("POST", { name: "Second", precondition: "Signed in", steps: [{ kind: "action", text: "Go", deviceLabel: "Pixel 8" }] }));
    expect(created.status).toBe(201);
    expect(created.body.position).toBe(1);
    expect(created.body.steps).toHaveLength(1);

    const renamed = await call<{ name: string; estimatedMinutes: number | null }>(`/api/flows/${created.body.id}`, req("PATCH", { name: "Second pass", estimatedMinutes: 15 }));
    expect(renamed.body.name).toBe("Second pass");
    expect(renamed.body.estimatedMinutes).toBe(15);

    const order = await call(`/api/templates/${template.id}/flows/order`, req("PUT", { ids: [created.body.id, flow.id] }));
    expect(order.status).toBe(200);
    let tpl = (await call<Template>(`/api/templates/${template.id}`)).body;
    expect(tpl.flows.map((f) => f.id)).toEqual([created.body.id, flow.id]);

    const gone = await call(`/api/flows/${created.body.id}`, req("DELETE"));
    expect(gone.status).toBe(204);
    tpl = (await call<Template>(`/api/templates/${template.id}`)).body;
    expect(tpl.flows.map((f) => f.position)).toEqual([0]);
  });

  test("archiving a template keeps its marks counting toward coverage", async () => {
    const before = (await call<{ covered: number }>(`/api/products/${productId}/coverage`)).body;
    const res = await call<Template>(`/api/templates/${template.id}`, req("PATCH", { status: "archived" }));
    expect(res.body.status).toBe("archived");
    const after = (await call<{ covered: number }>(`/api/products/${productId}/coverage`)).body;
    expect(after.covered).toBe(before.covered);
  });

  test("writes need an identity", async () => {
    const res = await app.request(`/api/steps/${flow.steps[0]!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });
});
