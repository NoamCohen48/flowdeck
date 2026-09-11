/**
 * The Electric shape proxy, against a real Electric.
 *
 * This test exists because the plan's first draft of the coverage shape pointed at
 * a view, and Electric cannot sync a view — it follows logical replication, which
 * only carries tables. Nothing short of a live Electric would have caught that.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sql as raw } from "drizzle-orm";
import { withActor, type ActorEnv } from "./actor.ts";
import { shapes } from "./shapes.ts";
import { db, query, sql } from "../db/client.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api/shapes", shapes);

type ShapeMessage =
  | { key: string; value: Record<string, unknown>; headers: { operation: string } }
  | { headers: { control: string } };

async function shape(path: string) {
  const res = await app.request(path);
  const messages = (await res.json()) as ShapeMessage[];
  return {
    status: res.status,
    handle: res.headers.get("electric-handle"),
    offset: res.headers.get("electric-offset"),
    rows: messages.filter((m): m is Extract<ShapeMessage, { value: unknown }> => "value" in m),
  };
}

let relayId: string;
let runId: string;
let templateId: string;

beforeAll(async () => {
  const [p] = await query<{ id: string }>(raw`select id from product where name = 'Relay'`);
  const [r] = await query<{ id: string }>(raw`select id from run limit 1`);
  if (!p || !r) throw new Error("database is not seeded");
  relayId = p.id;
  runId = r.id;
  const [t] = await query<{ id: string }>(raw`select id from template where product_id = ${p.id} limit 1`);
  templateId = t!.id;
});

describe("the allowlist", () => {
  test("an unknown shape name is refused, never forwarded", async () => {
    const res = await app.request("/api/shapes/flow_run?runId=x");
    expect(res.status).toBe(404);
  });

  test("a parameter that is not a UUID is refused before it reaches SQL", async () => {
    const res = await app.request(
      `/api/shapes/product.tests?productId=${encodeURIComponent("x' or 1=1--")}`,
    );
    expect(res.status).toBe(400);
  });

  test("a missing required parameter is refused", async () => {
    const res = await app.request("/api/shapes/run.flow_runs");
    expect(res.status).toBe(400);
  });
});

describe("shapes serve the seeded data, filtered", () => {
  test("run.flow_runs returns this run's flows and nothing else", async () => {
    const real = await shape(`/api/shapes/run.flow_runs?runId=${runId}&offset=-1`);
    expect(real.status).toBe(200);
    expect(real.rows.length).toBeGreaterThan(0);
    expect(real.rows.every((r) => r.value.run_id === runId)).toBe(true);

    const bogus = await shape(
      "/api/shapes/run.flow_runs?runId=00000000-0000-4000-8000-000000000000&offset=-1",
    );
    expect(bogus.rows).toHaveLength(0);
  });

  test("run.results filters through a subquery on flow_run", async () => {
    const real = await shape(`/api/shapes/run.results?runId=${runId}&offset=-1`);
    expect(real.rows.length).toBeGreaterThan(0);
    const bogus = await shape(
      "/api/shapes/run.results?runId=00000000-0000-4000-8000-000000000000&offset=-1",
    );
    expect(bogus.rows).toHaveLength(0);
  });

  test("product.marks and product.tests carry what the browser needs for coverage", async () => {
    const marks = await shape(`/api/shapes/product.marks?productId=${relayId}&offset=-1`);
    const tests = await shape(`/api/shapes/product.tests?productId=${relayId}&offset=-1`);
    expect(marks.rows.length).toBeGreaterThan(0);
    expect(tests.rows.length).toBeGreaterThan(0);

    // Every mark points at a test in this product — the subquery filter holds.
    const testIds = new Set(tests.rows.map((r) => r.value.id));
    expect(marks.rows.every((m) => testIds.has(m.value.test_id))).toBe(true);

    // And the seed's deliberately uncovered test is visible as such.
    const marked = new Set(marks.rows.map((m) => m.value.test_id));
    const uncovered = tests.rows.filter(
      (t) => !marked.has(t.value.id) && t.value.archived !== "true" && t.value.archived !== true,
    );
    expect(uncovered.length).toBeGreaterThanOrEqual(1);
  });

  test("flow.steps and flow.marks are one flow's editor state", async () => {
    const [flow] = await query<{ id: string; steps: number; marks: number }>(raw`
      select f.id,
        (select count(*) from step s where s.flow_id = f.id)::int as steps,
        (select count(*) from step_mark sm join step s on s.id = sm.step_id where s.flow_id = f.id)::int as marks
      from flow f where f.template_id = ${templateId}
      order by marks desc limit 1`);
    const steps = await shape(`/api/shapes/flow.steps?flowId=${flow!.id}&offset=-1`);
    const marks = await shape(`/api/shapes/flow.marks?flowId=${flow!.id}&offset=-1`);
    expect(steps.rows).toHaveLength(flow!.steps);
    expect(marks.rows).toHaveLength(flow!.marks);
    const stepIds = new Set(steps.rows.map((r) => r.value.id));
    expect(marks.rows.every((m) => stepIds.has(m.value.step_id as string))).toBe(true);
  });

  test("the response carries Electric's resume headers through the proxy", async () => {
    const s = await shape(`/api/shapes/run.flow_runs?runId=${runId}&offset=-1`);
    expect(s.handle).toBeTruthy();
    expect(s.offset).toBeTruthy();
  });
});

describe("live updates", () => {
  test("a write to Postgres arrives on an open live request", async () => {
    const initial = await shape(`/api/shapes/presence?scope=run:${runId}&offset=-1`);
    let offset = initial.offset!;
    const handle = initial.handle!;

    const actor = `probe-${Date.now()}`;
    // Write shortly after the first live request opens, the way a second tester's
    // claim lands while a screen is already subscribed.
    // `db.execute` is lazy — it must be awaited to run at all.
    setTimeout(() => {
      void (async () => {
        await db.execute(raw`
          insert into presence (actor, scope) values (${actor}, ${"run:" + runId})
        `);
      })();
    }, 300);

    // A live request returns on the *first* change after the offset, which might be
    // something stale from an earlier run — so, as a real client does, keep polling
    // and advancing the offset until the change we caused shows up.
    const deadline = Date.now() + 10_000;
    let seen: ShapeMessage | undefined;
    while (!seen && Date.now() < deadline) {
      const res = await app.request(
        `/api/shapes/presence?scope=run:${runId}&offset=${offset}&handle=${handle}&live=true`,
      );
      expect(res.status).toBe(200);
      offset = res.headers.get("electric-offset") ?? offset;
      const messages = (await res.json()) as ShapeMessage[];
      seen = messages.find((m) => "value" in m && m.value.actor === actor);
    }

    expect(seen).toBeDefined();
    expect((seen as { headers: { operation: string } }).headers.operation).toBe("insert");

    await db.execute(raw`delete from presence where actor = ${actor}`);
  }, 15_000);
});

process.on("beforeExit", () => void sql.end());
