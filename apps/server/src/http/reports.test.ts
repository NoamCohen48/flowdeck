/**
 * The issue feed, closing a day, and per-test history — checked
 * against the seeded testing day, which the seed left half-run with a failure,
 * a minor and a skipped in it.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, setActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

async function cookieFor(name: string) {
  const probe = new Hono<ActorEnv>();
  probe.get("/", async (c) => { await setActor(c, name); return c.text("ok"); });
  const res = (await probe.request("/")) as Response;
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Issue = {
  type: string;
  test: { id: string; versionId: string; version: number; title: string; expected: string };
  context: { flow: string; stepNumber: number; stepText: string; device: string };
  note: string | null;
  attachments: string[];
  blocking: boolean;
  recordedBy: string;
  recordedAt: string;
};
type Feed = { run: { id: string; product: string; template: string; closedAt: string | null }; issues: Issue[] };

let noa: string;
let runId: string;
let productId: string;

beforeAll(async () => {
  noa = await cookieFor("Noa");
  const products = (await call<{ id: string; name: string }[]>("/api/products")).body;
  productId = products.find((p) => p.name === "Relay")!.id;
  // The seeded day is the oldest run for Relay; the test suites add newer ones.
  const runs = (await call<{ id: string; date: string; closedAt: string | null }[]>(`/api/products/${productId}/runs`)).body;
  runId = [...runs].sort((a, b) => a.date.localeCompare(b.date))[0]!.id;
});

describe("the issue feed", () => {
  test("every non-pass result, typed and self-contained", async () => {
    const { status, body } = await call<Feed>(`/api/runs/${runId}/issues`);
    expect(status).toBe(200);
    expect(body.run.product).toBe("Relay");
    expect(body.run.template).toStartWith("Monthly regression");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues.every((i) => i.type !== "pass")).toBe(true);
    expect(new Set(body.issues.map((i) => i.type))).toEqual(new Set(["failure", "minor", "invalid_test"]));

    for (const i of body.issues) {
      expect(i.test.title).toBeTruthy();
      expect(i.test.version).toBeGreaterThan(0);
      expect(i.context.flow).toBeTruthy();
      expect(i.context.stepNumber).toBeGreaterThan(0);
      expect(i.context.device).toBeTruthy();
      expect(i.recordedBy).toBeTruthy();
    }
    const failure = body.issues.find((i) => i.type === "failure")!;
    expect(failure.note).toBeTruthy();
    const invalid = body.issues.find((i) => i.type === "invalid_test")!;
    expect(invalid.note).toBeTruthy();
    expect(invalid.blocking).toBe(false);
  });

  test("includePass returns the whole day", async () => {
    const problems = (await call<Feed>(`/api/runs/${runId}/issues`)).body.issues.length;
    const all = (await call<Feed>(`/api/runs/${runId}/issues?includePass=true`)).body.issues;
    expect(all.length).toBeGreaterThan(problems);
    expect(all.filter((i) => i.type === "pass").length).toBe(all.length - problems);
  });

  test("an unknown run is a 404", async () => {
    const { status } = await call(`/api/runs/00000000-0000-4000-8000-000000000000/issues`);
    expect(status).toBe(404);
  });
});

describe("closing a day", () => {
  test("close stamps the time, reopen clears it, and both need an identity", async () => {
    const anon = await call(`/api/runs/${runId}/close`, { method: "POST" });
    expect(anon.status).toBe(401);

    const closed = await call<{ closedAt: string | null }>(`/api/runs/${runId}/close`, { method: "POST", headers: { cookie: noa } });
    expect(closed.status).toBe(200);
    expect(closed.body.closedAt).toBeTruthy();
    const feed = (await call<Feed>(`/api/runs/${runId}/issues`)).body;
    expect(feed.run.closedAt).toBeTruthy();

    const reopened = await call<{ closedAt: string | null }>(`/api/runs/${runId}/close?reopen=true`, { method: "POST", headers: { cookie: noa } });
    expect(reopened.body.closedAt).toBeNull();
  });
});

describe("a test over time", () => {
  test("history lists every recorded result against the version it ran on", async () => {
    const feed = (await call<Feed>(`/api/runs/${runId}/issues`)).body;
    const failure = feed.issues.find((i) => i.type === "failure")!;
    const { status, body } = await call<{ runId: string; verdict: string; version: number; title: string; flow: string }[]>(`/api/tests/${failure.test.id}/history`);
    expect(status).toBe(200);
    const here = body.filter((h) => h.runId === runId);
    expect(here.length).toBeGreaterThanOrEqual(1);
    expect(here.some((h) => h.verdict === "fail")).toBe(true);
    expect(here[0]!.version).toBe(failure.test.version);
    expect(here[0]!.title).toBe(failure.test.title);
    expect(here[0]!.flow).toBe(failure.context.flow);
  });
});
