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

describe("starting a run", () => {
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

describe("claiming", () => {
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

  test("two people claiming in the same instant: exactly one is warned", async () => {
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

describe("recording verdicts", () => {
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

describe("blocking failures", () => {
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

  test("two testers on the same flow block independently", async () => {
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

describe("finishing and abandoning", () => {
  test("state transitions are recorded with a timestamp", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const { body } = await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie: noa } });
    const done = await call<{ state: string; finishedAt: string | null }>(`/api/flow-runs/${body.flowRun.id}/finish`, { method: "POST", headers: { cookie: noa } });
    expect(done.body.state).toBe("finished");
    expect(done.body.finishedAt).toBeTruthy();
  });
});

describe("identity and presence", () => {
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

describe("flagging a step as wrong", () => {
  async function claimed() {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const { body } = await call<{ flowRun: { id: string } }>(
      `/api/runs/${run.id}/flows/${flow.id}/claim`,
      { method: "POST", headers: { cookie: noa } },
    );
    return { run, flow, flowRunId: body.flowRun.id };
  }
  type Problem = { id: string; stepId: string; note: string; workaround: string | null; blocking: boolean; recordedBy: string };
  type RunWithProblems = Run & { stepProblems: Problem[] };

  test("a workaround is required unless the step blocks the rest of the flow", async () => {
    const { flow, flowRunId } = await claimed();
    const step = flow.steps[2]!;
    const bare = await call(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: step.id, note: "The button is gone" }, noa));
    expect(bare.status).toBe(400);
    const ok = await call<Problem>(
      `/api/flow-runs/${flowRunId}/step-problems`,
      json({ stepId: step.id, note: "The button is gone", workaround: "Used the menu instead" }, noa),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.recordedBy).toBe("Noa");
    expect(ok.body.blocking).toBe(false);
  });

  test("flagging the same step again replaces the report; the tests on it still record", async () => {
    const { flow, flowRunId, run } = await claimed();
    const step = flow.steps.find((s) => s.marks.length === 1)!;
    await call(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: step.id, note: "first wording", workaround: "a" }, noa));
    await call(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: step.id, note: "second wording", workaround: "b" }, noa));
    const verdict = await call(`/api/flow-runs/${flowRunId}/results`, json({ stepId: step.id, testId: step.marks[0], verdict: "pass", idempotencyKey: `t-${Date.now()}-stale-pass` }, noa));
    expect(verdict.status).toBe(201);
    const state = (await call<RunWithProblems>(`/api/runs/${run.id}`)).body;
    const mine = state.stepProblems.filter((p) => p.stepId === step.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.note).toBe("second wording");
  });

  test("a step the tester could not get past blocks what follows, like a blocking failure", async () => {
    const { flow, flowRunId, run } = await claimed();
    const at = flow.steps.findIndex((s) => s.marks.length > 0);
    const stuck = flow.steps[at]!;
    const later = flow.steps.slice(at + 1).find((s) => s.marks.length > 0)!;
    const flagged = await call<Problem>(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: stuck.id, note: "The screen no longer exists", blocking: true, workaround: "ignored" }, noa));
    expect(flagged.status).toBe(201);
    expect(flagged.body.workaround).toBeNull();

    const refused = await call(`/api/flow-runs/${flowRunId}/results`, json({ stepId: later.id, testId: later.marks[0], verdict: "pass", idempotencyKey: `t-${Date.now()}-after-stuck` }, noa));
    expect(refused.status).toBe(409);
    const alsoRefused = await call(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: later.id, note: "never reached", workaround: "x" }, noa));
    expect(alsoRefused.status).toBe(409);

    // The flagged step itself was reached: its own tests can still be recorded.
    const own = await call(`/api/flow-runs/${flowRunId}/results`, json({ stepId: stuck.id, testId: stuck.marks[0], verdict: "skipped", note: "cannot judge", idempotencyKey: `t-${Date.now()}-own` }, noa));
    expect(own.status).toBe(201);

    const feed = (await call<{ issues: unknown[]; stepProblems: { context: { stepNumber: number }; blocking: boolean }[] }>(`/api/runs/${run.id}/issues`)).body;
    expect(feed.stepProblems).toHaveLength(1);
    expect(feed.stepProblems[0]!.context.stepNumber).toBe(at + 1);
    expect(feed.stepProblems[0]!.blocking).toBe(true);
  });

  test("a report can be withdrawn and a verdict retracted; what they closed reopens", async () => {
    const { flow, flowRunId, run } = await claimed();
    const at = flow.steps.findIndex((s) => s.marks.length > 0);
    const stuck = flow.steps[at]!;
    const later = flow.steps.slice(at + 1).find((s) => s.marks.length > 0)!;
    await call(`/api/flow-runs/${flowRunId}/step-problems`, json({ stepId: stuck.id, note: "gone", blocking: true }, noa));
    expect((await call(`/api/flow-runs/${flowRunId}/results`, json({ stepId: later.id, testId: later.marks[0], verdict: "pass", idempotencyKey: `t-${Date.now()}-w1` }, noa))).status).toBe(409);

    const withdrawn = await call(`/api/flow-runs/${flowRunId}/step-problems/${stuck.id}`, { method: "DELETE", headers: { cookie: noa } });
    expect(withdrawn.status).toBe(200);
    expect((await call(`/api/flow-runs/${flowRunId}/step-problems/${stuck.id}`, { method: "DELETE", headers: { cookie: noa } })).status).toBe(404);

    const recorded = await call<{ id: string }>(`/api/flow-runs/${flowRunId}/results`, json({ stepId: later.id, testId: later.marks[0], verdict: "fail", note: "broken", blocking: true, idempotencyKey: `t-${Date.now()}-w2` }, noa));
    expect(recorded.status).toBe(201);
    const retracted = await call(`/api/results/${recorded.body.id}`, { method: "DELETE", headers: { cookie: noa } });
    expect(retracted.status).toBe(200);
    const state = (await call<{ results: { id: string }[] }>(`/api/runs/${run.id}`)).body;
    expect(state.results.some((r) => r.id === recorded.body.id)).toBe(false);
  });
});

describe("live progress for the coordinator", () => {
  const progress = (step: number) => ({
    step,
    total: 8,
    counts: { pass: 1, fail: 1, minor: 0, skipped: 0 },
    blockedFrom: step + 1,
    issues: [{ step, testId: null, kind: "flag", note: "The button moved", blocking: true }],
    updatedAt: new Date().toISOString(),
  });
  const put = (body: unknown, cookie: string): RequestInit => ({ ...json(body, cookie), method: "PUT" });

  async function claimedBy(cookie: string) {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const { body } = await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie } });
    return { run, flowRunId: body.flowRun.id };
  }

  test("the tester running a flow publishes where they are; the run reads it back", async () => {
    const { run, flowRunId } = await claimedBy(noa);
    const res = await call<{ progress: { step: number } | null }>(`/api/flow-runs/${flowRunId}/progress`, put(progress(2), noa));
    expect(res.status).toBe(200);
    expect(res.body.progress?.step).toBe(2);
    const again = (await call<{ flowRuns: { id: string; progress: { step: number } | null }[] }>(`/api/runs/${run.id}`)).body;
    expect(again.flowRuns.find((fr) => fr.id === flowRunId)?.progress?.step).toBe(2);
  });

  test("nobody else can publish for them", async () => {
    const { flowRunId } = await claimedBy(noa);
    const res = await call(`/api/flow-runs/${flowRunId}/progress`, put(progress(1), dana));
    expect(res.status).toBe(409);
  });

  test("progress is never counted as a result", async () => {
    const { run, flowRunId } = await claimedBy(noa);
    await call(`/api/flow-runs/${flowRunId}/progress`, put(progress(3), noa));
    const again = (await call<Run>(`/api/runs/${run.id}`)).body;
    expect(again.results.filter((r) => r.id && again.flowRuns.some((fr) => fr.id === flowRunId))).toHaveLength(0);
  });

  for (const action of ["finish", "abandon"] as const) {
    test(`${action} clears it, and a stale tab cannot bring it back`, async () => {
      const { flowRunId } = await claimedBy(noa);
      await call(`/api/flow-runs/${flowRunId}/progress`, put(progress(1), noa));
      const done = await call<{ progress: unknown }>(`/api/flow-runs/${flowRunId}/${action}`, { method: "POST", headers: { cookie: noa } });
      expect(done.body.progress).toBeNull();
      const late = await call(`/api/flow-runs/${flowRunId}/progress`, put(progress(4), noa));
      expect(late.status).toBe(409);
    });
  }
});

describe("the runs list carries each day's tally", () => {
  test("worst result per test, the same rule the board uses", async () => {
    const run = await freshRun();
    const flow = run.snapshot.flows.find((f) => f.name.startsWith("Messaging across"))!;
    const { body } = await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flow.id}/claim`, { method: "POST", headers: { cookie: noa } });
    const marked = flow.steps.filter((s) => s.marks.length);
    const [first, second] = [marked[0]!, marked[1]!];
    const record = (step: { id: string }, testId: string, verdict: string, note: string | null = null) =>
      call(`/api/flow-runs/${body.flowRun.id}/results`, json({ stepId: step.id, testId, verdict, note, blocking: false, idempotencyKey: `${run.id}:${step.id}:${testId}:${verdict}` }, noa));
    await record(first, first.marks[0]!, "pass");
    await record(second, second.marks[0]!, "fail", "broken");

    const product = (await call<{ id: string; name: string }[]>("/api/products")).body.find((p) => p.name === "Relay")!;
    const list = (await call<{ id: string; total: number; counts: Record<string, number>; notReached: number }[]>(`/api/products/${product.id}/runs`)).body;
    const mine = list.find((r) => r.id === run.id)!;
    const total = new Set(run.snapshot.flows.flatMap((f) => f.steps.flatMap((s) => s.marks))).size;
    expect(mine.total).toBe(total);
    expect(mine.counts).toEqual({ pass: first.marks[0] === second.marks[0] ? 0 : 1, fail: 1, minor: 0, skipped: 0 });
    expect(mine.notReached).toBe(total - (mine.counts.pass! + 1));
  });
});

describe("live progress arriving out of order", () => {
  test("an older update landing late does not roll the board back", async () => {
    const run = await freshRun();
    const flowId = run.snapshot.flows[0]!.id;
    const { body } = await call<{ flowRun: { id: string } }>(`/api/runs/${run.id}/flows/${flowId}/claim`, { method: "POST", headers: { cookie: noa } });
    const at = (step: number, updatedAt: string) => ({
      method: "PUT",
      headers: { "content-type": "application/json", cookie: noa },
      body: JSON.stringify({ step, total: 5, counts: { pass: step, fail: 0, minor: 0, skipped: 0 }, blockedFrom: null, issues: [], updatedAt }),
    });
    await call(`/api/flow-runs/${body.flowRun.id}/progress`, at(4, "2026-11-01T10:00:05.000Z"));
    const late = await call<{ progress: { step: number } }>(`/api/flow-runs/${body.flowRun.id}/progress`, at(2, "2026-11-01T10:00:01.000Z"));
    expect(late.status).toBe(200);
    expect(late.body.progress.step).toBe(4);
  });
});
