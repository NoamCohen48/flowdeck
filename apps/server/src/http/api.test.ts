/**
 * API integration tests. These run against a real Postgres — the seeded one in CI —
 * because the things most likely to be wrong here are the things a mocked database
 * cannot catch: a CHECK constraint that does not fire, a view that returns the
 * wrong shape, a transaction that half-commits.
 *
 * They are not skippable. A green run with the database quietly absent would be a
 * worse outcome than a red one.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { db, sql } from "../db/client.ts";
import { sql as raw } from "drizzle-orm";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

/** `app.request` may return a Response or a Promise of one; always await it. */
async function req(path: string, init?: RequestInit): Promise<Response> {
  return await app.request(path, init);
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await req(path, init);
  return (await res.json()) as T;
}

/** The name-picker cookie is signed, so tests sign in the same way a browser would. */
async function signedActorCookie(name: string): Promise<string> {
  const probe = new Hono<ActorEnv>();
  probe.get("/", async (c) => {
    const { setActor } = await import("./actor.ts");
    await setActor(c, name);
    return c.text("ok");
  });
  const res = await probe.request("/");
  return (res as Response).headers.get("set-cookie")!.split(";")[0]!;
}

let cookie: string;
let relayId: string;

beforeAll(async () => {
  cookie = await signedActorCookie("Noa");
  const res = await req("/api/products");
  const products = (await res.json()) as { id: string; name: string }[];
  const relay = products.find((p) => p.name === "Relay");
  if (!relay) {
    throw new Error(
      "the database is not seeded — run `bun run db:migrate && bun run db:seed`",
    );
  }
  relayId = relay.id;
});

describe("products", () => {
  test("lists the seeded products", async () => {
    const res = await req("/api/products");
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { name: string }[]).map((p) => p.name);
    expect(names).toContain("Relay");
    expect(names).toContain("Beacon Console");
  });

  test("a made-up product id is a 404, not a 500", async () => {
    const res = await req(
      "/api/products/00000000-0000-4000-8000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  test("a product is found by its slug as well as its id; an unknown one is a 404", async () => {
    const res = await req("/api/products/relay");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slug: string }).slug).toBe("relay");
    expect((await req("/api/products/no-such-product")).status).toBe(404);
  });

  test("a malformed id fails validation with the field named", async () => {
    const res = await req("/api/products/not-a-uuid/tests");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: unknown[] };
    expect(body.details.length).toBeGreaterThan(0);
  });
});

describe("tests — assertions, versioned", () => {
  test("the library excludes archived tests unless asked", async () => {
    const res = await req(`/api/products/${relayId}/tests`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { archived: boolean }[];
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => !r.archived)).toBe(true);
  });

  test("creating requires an identity — every write is attributed", async () => {
    const res = await req(`/api/products/${relayId}/tests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tests: [{ title: "x", expectedResult: "y" }] }),
    });
    expect(res.status).toBe(401);
  });

  test("bulk create returns tests in request order, so an importer can map them", async () => {
    const titles = ["Import order one", "Import order two", "Import order three"];
    const res = await req(`/api/products/${relayId}/tests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        tests: titles.map((title) => ({
          title,
          expectedResult: "It holds.",
          metadata: { tags: ["import-test"] },
        })),
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { current: { title: string; version: number } }[];
    expect(created.map((t) => t.current.title)).toEqual(titles);
    expect(created.every((t) => t.current.version === 1)).toBe(true);
  });

  test("an edit creates a new version and leaves the old one intact", async () => {
    const created = await getJson<{ id: string; current: { id: string } }[]>(
      `/api/products/${relayId}/tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          tests: [{ title: "Original wording", expectedResult: "Original expectation." }],
        }),
      },
    );
    const testId = created[0]!.id;
    const v1Id = created[0]!.current.id;

    const patched = await req(`/api/tests/${testId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "Revised wording" }),
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as {
      current: { id: string; version: number; title: string; expectedResult: string };
    };
    expect(after.current.version).toBe(2);
    expect(after.current.title).toBe("Revised wording");
    // Unspecified fields carry forward rather than being blanked.
    expect(after.current.expectedResult).toBe("Original expectation.");
    expect(after.current.id).not.toBe(v1Id);

    const versions = await getJson<{ id: string; version: number; title: string }[]>(
      `/api/tests/${testId}/versions`,
    );
    expect(versions).toHaveLength(2);
    // The point of the whole mechanism: v1's exact wording is still readable.
    expect(versions[0]!.title).toBe("Original wording");
    expect(versions[0]!.id).toBe(v1Id);
  });

  test("an empty edit is refused rather than creating an identical version", async () => {
    const created = await getJson<{ id: string }[]>(
      `/api/products/${relayId}/tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tests: [{ title: "Untouched", expectedResult: "Fine." }] }),
      },
    );

    const res = await req(`/api/tests/${created[0]!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("archiving reports how many places marked it, for the confirmation", async () => {
    const rows = await getJson<{ id: string; current: { title: string } }[]>(
      `/api/products/${relayId}/tests`,
    );
    // A test the demo's flows actually mark, so the counts are not all zero.
    const marked = rows.find((r) =>
      r.current.title.startsWith("Emoji reaction syncs"),
    )!;

    const res = await req(`/api/tests/${marked.id}/archive`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      test: { archived: boolean };
      marks: { steps: number; flows: number; templates: number };
    };
    expect(body.test.archived).toBe(true);
    expect(body.marks.steps).toBeGreaterThan(0);
    expect(body.marks.flows).toBeGreaterThan(0);

    // Archiving is reversible; hard deletion is never offered.
    const undone = await req(`/api/tests/${marked.id}/archive?undo=true`, {
      method: "POST",
      headers: { cookie },
    });
    expect(((await undone.json()) as { test: { archived: boolean } }).test.archived).toBe(
      false,
    );
  });
});

describe("coverage", () => {
  test("reports totals and flags the test nothing marks", async () => {
    const res = await req(`/api/products/${relayId}/coverage`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      covered: number;
      uncovered: number;
      tests: { testId: string; covered: boolean; needsAttention: boolean }[];
    };

    expect(body.covered + body.uncovered).toBe(body.total);
    // T-26 is seeded uncovered on purpose, so the red row has data.
    expect(body.uncovered).toBeGreaterThanOrEqual(1);
    expect(body.tests.some((t) => t.needsAttention)).toBe(true);
    // needsAttention is never set on something that is covered.
    expect(body.tests.every((t) => !(t.covered && t.needsAttention))).toBe(true);
  });

  test("a test marked only by an archived template still counts as covered", async () => {
    const coverage = await getJson<{
      tests: { testId: string; covered: boolean; templateIds: string[] }[];
    }>(`/api/products/${relayId}/coverage`);
    const templates = await getJson<{ id: string; status: string }[]>(
      `/api/products/${relayId}/templates`,
    );
    const archivedIds = new Set(
      templates.filter((t) => t.status === "archived").map((t) => t.id),
    );
    expect(archivedIds.size).toBeGreaterThan(0);

    const onlyArchived = coverage.tests.filter(
      (t) => t.templateIds.length > 0 && t.templateIds.every((id) => archivedIds.has(id)),
    );
    expect(onlyArchived.length).toBeGreaterThan(0);
    expect(onlyArchived.every((t) => t.covered)).toBe(true);
  });
});

describe("templates", () => {
  test("scope is reported, and the misses are listable", async () => {
    const templates = await getJson<{ id: string; name: string }[]>(
      `/api/products/${relayId}/templates`,
    );
    const regression = templates.find((t) => t.name.startsWith("Monthly regression"))!;

    const scope = await getJson<{
      covers: number;
      productTotal: number;
      misses: string[];
    }>(`/api/templates/${regression.id}/scope`);
    // A template targeting one setup reaches a slice of the library, and that is
    // not a deficiency — it is why several templates exist.
    expect(scope.covers).toBeGreaterThan(0);
    expect(scope.covers).toBeLessThan(scope.productTotal);
    expect(scope.misses.length).toBe(scope.productTotal - scope.covers);
  });

  test("device hand-offs are derived, and every step's device is introduced in time", async () => {
    const templates = await getJson<{ id: string; name: string }[]>(
      `/api/products/${relayId}/templates`,
    );
    const regression = templates.find((t) => t.name.startsWith("Monthly regression"))!;
    const full = await getJson<{
      flows: { id: string; name: string; steps: { deviceLabel: string }[] }[];
    }>(`/api/templates/${regression.id}`);
    const twoDevice = full.flows.find((f) => f.name.startsWith("Messaging across"))!;

    const res = await req(`/api/flows/${twoDevice.id}/devices`);
    expect(res.status).toBe(200);
    const { devices } = (await res.json()) as {
      devices: { label: string; letter: string; introducedAtIndex: number }[];
    };

    // The demo's flow uses the Pixel, then the iPhone, then a second laptop.
    expect(devices.map((d) => d.letter)).toEqual(["A", "B", "C"]);
    expect(devices[0]!.label).toBe("Pixel 8");
    expect(devices[0]!.introducedAtIndex).toBe(0);

    for (const [index, step] of twoDevice.steps.entries()) {
      const device = devices.find((d) => d.label === step.deviceLabel)!;
      expect(device.introducedAtIndex).toBeLessThanOrEqual(index);
    }
  });
});

describe("constraints are enforced by the database, not only the API", () => {
  test("a failing verdict without a note is rejected at the row level", async () => {
    // Written directly, bypassing the API, because a migration script or a future
    // route must not be able to create a bug report with no description.
    // `db.execute` returns a lazy builder, so it is awaited inside a thunk rather
    // than handed to `.rejects` directly.
    const attempt = async () =>
      db.execute(raw`
      insert into test_result
        (flow_run_id, step_id, test_id, test_version_id, verdict, recorded_by, idempotency_key)
      select fr.id, s.id, sm.test_id, t.current_version_id, 'fail', 'Noa', 'constraint-probe'
      from flow_run fr
      join step s on true
      join step_mark sm on sm.step_id = s.id
      join test t on t.id = sm.test_id
      limit 1
    `);
    expect(attempt()).rejects.toThrow(/test_result_note_required/);
  });

  test("blocking is only meaningful on a failure", async () => {
    const attempt = async () =>
      db.execute(raw`
      insert into test_result
        (flow_run_id, step_id, test_id, test_version_id, verdict, blocking, recorded_by, idempotency_key)
      select fr.id, s.id, sm.test_id, t.current_version_id, 'pass', true, 'Noa', 'constraint-probe-2'
      from flow_run fr
      join step s on true
      join step_mark sm on sm.step_id = s.id
      join test t on t.id = sm.test_id
      limit 1
    `);
    expect(attempt()).rejects.toThrow(/test_result_blocking_only_on_fail/);
  });
});

describe("the OpenAPI document", () => {
  test("is generated and describes the endpoints adapters depend on", async () => {
    const res = await req("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    for (const path of [
      "/products/{productId}/tests",
      "/tests/{testId}",
      "/products/{productId}/coverage",
      "/products/{productId}/templates",
    ]) {
      expect(doc.paths[path]).toBeDefined();
    }
  });
});

/** `postgres` keeps the process alive otherwise. */
process.on("beforeExit", () => void sql.end());
