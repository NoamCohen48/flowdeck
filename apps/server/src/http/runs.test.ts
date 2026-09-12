/**
 * The testing day, end to end against the seeded database: start a run, claim,
 * record verdicts, block, finish. These are the rules seven people rely on for
 * four hours, so each one is exercised through the API rather than assumed.
 */
import { beforeAll, describe, expect, test } from "bun:test";
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

const json = (body: unknown, cookie: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Run = {
  id: string;
  snapshot: {
    flows: { id: string; name: string; steps: { id: string; marks: string[] }[] }[];
    tests: { id: string; versionId: string }[];
  };
  flowRuns: { id: string; flowId: string; claimedBy: string | null; state: string }[];
  results: { id: string; stepId: string; testId: string; verdict: string; blocking: boolean }[];
};

let noa: string;
let dana: string;
let templateId: string;

beforeAll(async () => {
  noa = await cookieFor("Noa");
  dana = await cookieFor("Dana");
  const products = (await call<{ id: string; name: string }[]>("/api/products")).body;
  const relay = products.find((p) => p.name === "Relay")!;
  const templates = (await call<{ id: string; name: string; status: string }[]>(
    `/api/products/${relay.id}/templates`,
  )).body;
  templateId = templates.find((t) => t.name.startsWith("Monthly regression"))!.id;
});

async function freshRun(): Promise<Run> {
  const { status, body } = await call<Run>(`/api/templates/${templateId}/runs?force=true`, {
    method: "POST",
    headers: { cookie: noa },
  });
  expect(status).toBe(201);
  return body;
}

describe("starting a run (D8, D21, D24)", () => {
  test("warns when one is already open, and proceeds with force", async () => {
    await freshRun();
    const warned = await call<{ openRunId: string }>(`/api/templates/${templateId}/runs`, {
      method: "POST",
      headers: { cookie: noa },
    });
    expect(warned.status).toBe(409);
    expect(warned.body.openRunId).toBeTruthy();
  });

  test("the snapshot is frozen: an edit to the template after start does not reach the run", async () => {
    const run = await freshRun();
    const before = run.snapshot.flows.map((f) => f.steps.length);

    // Add a step to the live template through the API. (Creating a whole new
    // template is the only bulk write available yet; a direct insert stands in.)
    const { db } = await import("../db/client.ts");
    const { step } = await import("../db/schema.ts");
    const flowId = run.snapshot.flows[0]!.id;
    await db.insert(step).values({
      flowId,
      position: 999,
      kind: "action",
      text: "Added after the run started",
      deviceLabel: "Pixel 8",
    });

    const again = (await call<Run>(`/api/runs/${run.id}`)).body;
    expect(again.snapshot.flows.map((f) => f.steps.length)).toEqual(before);
  });

  test("the snapshot pins test versions, so results read against the wording testers saw", async () => {
    const run = await freshRun();
    expect(run.snapshot.tests.length).toBeGreaterThan(0);
    expect(run.snapshot.tests.every((t) => t.versionId)).toBe(true);
  });
});

describe("claiming (D9, D26)", () => {
  test("requires an identity", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const res = await call(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("a second tester is told who holds it, and can run alongside", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;

    const first = await call<{ flowRun: { claimedBy: string }; alsoRunning: unknown[] }>(
      `/api/runs/${run.id}/flows/${flowId}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    expect(first.status).toBe(200);
    expect(first.body.flowRun.claimedBy).toBe("Noa");
    expect(first.body.alsoRunning).toHaveLength(0);

    // Dana tries: told Noa is on it, nothing changes yet.
    const warned = await call<{ alsoRunning: { claimedBy: string }[] }>(
      `/api/runs/${run.id}/flows/${flowId}/claim`,
      { method: "POST", headers: { cookie: dana } },
    );
    expect(warned.status).toBe(409);
    expect(warned.body.alsoRunning.map((f) => f.claimedBy)).toEqual(["Noa"]);

    // Dana confirms: her own FlowRun, Noa's untouched.
    const confirmed = await call<{ flowRun: { id: string; claimedBy: string } }>(
      `/api/runs/${run.id}/flows/${flowId}/claim?confirm=true`,
      { method: "POST", headers: { cookie: dana } },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.flowRun.claimedBy).toBe("Dana");

    const state = (await call<Run>(`/api/runs/${run.id}`)).body;
    const onThisFlow = state.flowRuns.filter((f) => f.flowId === flowId && f.state === "claimed");
    expect(onThisFlow.map((f) => f.claimedBy).sort()).toEqual(["Dana", "Noa"]);
  });

  test("two people claiming in the same instant: exactly one is warned (D26)", async () => {
    // The check and the write share a per-flow lock, so the second claim waits
    // for the first to commit and then sees it — never two silent 200s.
    for (let round = 0; round < 5; round++) {
      const run = await freshRun();
      const flowId = run.snapshot.flows[0]!.id;
      const [a, b] = await Promise.all([
        call<{ alsoRunning: unknown[] }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie: noa } }),
        call<{ alsoRunning: unknown[] }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie: dana } }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const state = (await call<Run>(`/api/runs/${run.id}`)).body;
      expect(state.flowRuns.filter((f) => f.flowId === flowId && f.state === "claimed")).toHaveLength(1);
    }
  });

  test("re-claiming your own flow returns it rather than duplicating it", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const a = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flowId}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    const b = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flowId}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    expect(b.body.flowRun.id).toBe(a.body.flowRun.id);
  });
});

describe("recording verdicts (D12, D13, D36)", () => {
  async function claimed() {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const { body } = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flow.id}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    return { run, flow, flowRunId: body.flowRun.id };
  }

  test("a pass records; the same key twice records once", async () => {
    const { flow, flowRunId, run } = await claimed();
    const step = flow.steps.find((s) => s.marks.length === 1)!;
    const payload = {
      stepId: step.id,
      testId: step.marks[0]!,
      verdict: "pass",
      idempotencyKey: `t-${Date.now()}-double-tap`,
    };
    const a = await call<{ id: string }>(`/api/flow-runs/${flowRunId}/results`, json(payload, noa));
    const b = await call<{ id: string }>(`/api/flow-runs/${flowRunId}/results`, json(payload, noa));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);

    const state = (await call<Run>(`/api/runs/${run.id}`)).body;
    expect(state.results.filter((r) => r.stepId === step.id)).toHaveLength(1);
  });

  test("changing your mind replaces the earlier verdict rather than adding to it", async () => {
    const { flow, flowRunId, run } = await claimed();
    const step = flow.steps.find((s) => s.marks.length === 1)!;
    const base = { stepId: step.id, testId: step.marks[0]! };
    await call(`/api/flow-runs/${flowRunId}/results`, json({ ...base, verdict: "pass", idempotencyKey: `k1-${Date.now()}` }, noa));
    await call(`/api/flow-runs/${flowRunId}/results`, json({ ...base, verdict: "minor", note: "slow", idempotencyKey: `k2-${Date.now()}` }, noa));

    const state = (await call<Run>(`/api/runs/${run.id}`)).body;
    const forStep = state.results.filter((r) => r.stepId === step.id);
    expect(forStep).toHaveLength(1);
    expect(forStep[0]!.verdict).toBe("minor");
  });

  test("fail and skipped need a note; the message says why", async () => {
    const { flow, flowRunId } = await claimed();
    const step = flow.steps.find((s) => s.marks.length === 1)!;
    for (const verdict of ["fail", "skipped"]) {
      const res = await call<{ details: { path: string[] }[] }>(
        `/api/flow-runs/${flowRunId}/results`,
        json({ stepId: step.id, testId: step.marks[0], verdict, idempotencyKey: `n-${verdict}-${Date.now()}` }, noa),
      );
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.path.includes("note"))).toBe(true);
    }
  });

  test("blocking is refused on anything but a failure", async () => {
    const { flow, flowRunId } = await claimed();
    const step = flow.steps.find((s) => s.marks.length === 1)!;
    const res = await call(
      `/api/flow-runs/${flowRunId}/results`,
      json({ stepId: step.id, testId: step.marks[0], verdict: "pass", blocking: true, idempotencyKey: `b-${Date.now()}` }, noa),
    );
    expect(res.status).toBe(400);
  });

  test("a step that does not mark the test is refused", async () => {
    const { flow, flowRunId } = await claimed();
    const [a, b] = flow.steps.filter((s) => s.marks.length === 1);
    const res = await call(
      `/api/flow-runs/${flowRunId}/results`,
      json({ stepId: a!.id, testId: b!.marks[0], verdict: "pass", idempotencyKey: `x-${Date.now()}` }, noa),
    );
    expect(res.status).toBe(400);
  });

  test("pass-all records every test the step marks, once each", async () => {
    const { flow, flowRunId, run } = await claimed();
    const step = flow.steps.find((s) => s.marks.length >= 2)!;
    const prefix = `pa-${Date.now()}`;
    const a = await call<unknown[]>(`/api/flow-runs/${flowRunId}/pass-all`, json({ stepId: step.id, idempotencyKeyPrefix: prefix }, noa));
    const b = await call<unknown[]>(`/api/flow-runs/${flowRunId}/pass-all`, json({ stepId: step.id, idempotencyKeyPrefix: prefix }, noa));
    expect(a.status).toBe(201);
    expect(a.body).toHaveLength(step.marks.length);
    expect(b.body).toHaveLength(step.marks.length);

    const state = (await call<Run>(`/api/runs/${run.id}`)).body;
    expect(state.results.filter((r) => r.stepId === step.id)).toHaveLength(step.marks.length);
  });
});

describe("blocking failures (D11)", () => {
  test("a blocking fail closes every later step; earlier steps still accept verdicts", async () => {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const { body } = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flow.id}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    const flowRunId = body.flowRun.id;
    const marked = flow.steps.filter((s) => s.marks.length > 0);
    const [first, middle, last] = [marked[0]!, marked[Math.floor(marked.length / 2)]!, marked.at(-1)!];

    const blocked = await call(
      `/api/flow-runs/${flowRunId}/results`,
      json({ stepId: middle.id, testId: middle.marks[0], verdict: "fail", note: "App froze on send.", blocking: true, idempotencyKey: `blk-${Date.now()}` }, noa),
    );
    expect(blocked.status).toBe(201);

    // Later: refused, because recording a pass for a wedged step would be a lie.
    const after = await call<{ error: string }>(
      `/api/flow-runs/${flowRunId}/results`,
      json({ stepId: last.id, testId: last.marks[0], verdict: "pass", idempotencyKey: `aft-${Date.now()}` }, noa),
    );
    expect(after.status).toBe(409);
    expect(after.body.error).toMatch(/blocked/);

    const passAll = await call(`/api/flow-runs/${flowRunId}/pass-all`, json({ stepId: last.id, idempotencyKeyPrefix: `paa-${Date.now()}` }, noa));
    expect(passAll.status).toBe(409);

    // Earlier: still fine — the tester may be catching up on a step they skipped past.
    const before = await call(
      `/api/flow-runs/${flowRunId}/results`,
      json({ stepId: first.id, testId: first.marks[0], verdict: "pass", idempotencyKey: `bef-${Date.now()}` }, noa),
    );
    expect(before.status).toBe(201);
  });

  test("a non-blocking fail leaves the rest of the flow open", async () => {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const { body } = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flow.id}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    const marked = flow.steps.filter((s) => s.marks.length > 0);
    await call(
      `/api/flow-runs/${body.flowRun.id}/results`,
      json({ stepId: marked[0]!.id, testId: marked[0]!.marks[0], verdict: "fail", note: "Wrong label.", blocking: false, idempotencyKey: `nb-${Date.now()}` }, noa),
    );
    const later = await call(
      `/api/flow-runs/${body.flowRun.id}/results`,
      json({ stepId: marked.at(-1)!.id, testId: marked.at(-1)!.marks[0], verdict: "pass", idempotencyKey: `nb2-${Date.now()}` }, noa),
    );
    expect(later.status).toBe(201);
  });

  test("two testers on the same flow block independently (D26)", async () => {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const n = (await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flow.id}/claim`, { method: "POST", headers: { cookie: noa } })).body.flowRun.id;
    const d = (await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flow.id}/claim?confirm=true`, { method: "POST", headers: { cookie: dana } })).body.flowRun.id;
    const marked = flow.steps.filter((s) => s.marks.length > 0);

    await call(`/api/flow-runs/${n}/results`, json({ stepId: marked[0]!.id, testId: marked[0]!.marks[0], verdict: "fail", note: "Stuck.", blocking: true, idempotencyKey: `tb-${Date.now()}` }, noa));
    // Dana's run is not blocked by Noa's failure.
    const danaLater = await call(`/api/flow-runs/${d}/results`, json({ stepId: marked.at(-1)!.id, testId: marked.at(-1)!.marks[0], verdict: "pass", idempotencyKey: `td-${Date.now()}` }, dana));
    expect(danaLater.status).toBe(201);
  });
});

describe("finishing and abandoning (D10, D25)", () => {
  test("state transitions are recorded with a timestamp", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const { body } = await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie: noa } });
    const done = await call<{ state: string; finishedAt: string | null }>(`/api/flow-runs/${body.flowRun.id}/finish`, { method: "POST", headers: { cookie: noa } });
    expect(done.body.state).toBe("finished");
    expect(done.body.finishedAt).toBeTruthy();
  });
});

describe("identity and presence (D37, D38)", () => {
  test("picking a name sets the cookie and lists the actor", async () => {
    const res = await app.request("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tomer" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const me = await call<{ name: string }>("/api/me", { headers: { cookie } });
    expect(me.body.name).toBe("Tomer");
    const actors = (await call<string[]>("/api/actors")).body;
    expect(actors).toContain("Tomer");
  });

  test("a heartbeat needs an identity and a well-formed scope", async () => {
    const run = await freshRun();
    const anon = await app.request("/api/presence", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: `run:${run.id}` }) });
    expect(anon.status).toBe(401);
    const bad = await app.request("/api/presence", { method: "PUT", headers: { "content-type": "application/json", cookie: noa }, body: JSON.stringify({ scope: "run:nope" }) });
    expect(bad.status).toBe(400);
    const ok = await app.request("/api/presence", { method: "PUT", headers: { "content-type": "application/json", cookie: noa }, body: JSON.stringify({ scope: `run:${run.id}` }) });
    expect(ok.status).toBe(204);
  });
});


describe("transaction ids for optimistic reconciliation", () => {
  test("every live-surface write reports the txid it committed in", async () => {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const claim = await call<{ txid: number; flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flow.id}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    expect(claim.body.txid).toBeGreaterThan(0);

    const step = flow.steps.find((s) => s.marks.length === 1)!;
    const result = await call<{ txid: number }>(
      `/api/flow-runs/${claim.body.flowRun.id}/results`,
      json({ stepId: step.id, testId: step.marks[0], verdict: "pass", idempotencyKey: `tx-${Date.now()}` }, noa),
    );
    expect(result.body.txid).toBeGreaterThan(claim.body.txid);

    const done = await call<{ txid: number }>(`/api/flow-runs/${claim.body.flowRun.id}/finish`, { method: "POST", headers: { cookie: noa } });
    expect(done.body.txid).toBeGreaterThan(result.body.txid);
  });
});

process.on("beforeExit", () => void sql.end());
