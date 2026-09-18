/**
 * The scripted path: identity by header, and a whole suite landing in one
 * request. These are the two things an import script relies on that the web
 * app never exercises.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, setActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { sql } from "../db/client.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "content-type": "application/json", "x-flowdeck-actor": "importer", ...headers },
  body: JSON.stringify(body),
});

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Test = { id: string; current: { title: string; createdBy: string } };
type Template = { id: string; name: string; flows: { steps: { marks: string[] }[] }[] };
type ImportResult = { keys: Record<string, string>; tests: Test[]; templates: Template[] };

let productId: string;

beforeAll(async () => {
  const res = await call<{ id: string }>(
    "/api/products",
    json("POST", { name: `import-scratch-${Date.now()}`, description: "" }),
  );
  productId = res.body.id;
});

afterAll(async () => {
  await sql`delete from product where id = ${productId}`;
  await sql`delete from actor where name in ('importer', 'header-wins')`;
});

describe("identity by header", () => {
  test("a write with only the header is attributed to it", async () => {
    const res = await call<Test[]>(
      `/api/products/${productId}/tests`,
      json("POST", { tests: [{ title: "by header", expectedResult: "attributed" }] }),
    );
    expect(res.status).toBe(201);
    expect(res.body[0]!.current.createdBy).toBe("importer");
  });

  test("the header wins over a cookie", async () => {
    const probe = new Hono<ActorEnv>();
    probe.get("/", async (c) => {
      await setActor(c, "cookie-person");
      return c.text("ok");
    });
    const cookie = ((await probe.request("/")) as Response).headers.get("set-cookie")!.split(";")[0]!;
    const me = await call<{ name: string }>("/api/me", {
      headers: { cookie, "x-flowdeck-actor": "header-wins" },
    });
    expect(me.body.name).toBe("header-wins");
  });

  test("no header and no cookie is a 401 that says how to identify", async () => {
    const res = await call<{ error: string }>(`/api/products/${productId}/tests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tests: [{ title: "x", expectedResult: "y" }] }),
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("X-Flowdeck-Actor");
  });
});

describe("bundle import", () => {
  test("tests keyed by the caller, templates marking by key, one transaction", async () => {
    const res = await call<ImportResult>(
      `/api/products/${productId}/import`,
      json("POST", {
        tests: [
          { key: "ROW-1", title: "Login works", expectedResult: "Home screen" },
          { key: "ROW-2", title: "Logout works", expectedResult: "Login screen", metadata: { priority: "high" } },
        ],
        templates: [
          {
            name: "Smoke",
            flows: [
              {
                name: "Sign in and out",
                steps: [
                  { kind: "action", text: "Open the app", deviceLabel: "Phone" },
                  { kind: "assertion", text: "Sign in", expectedResult: "Home", deviceLabel: "Phone", marks: ["ROW-1"] },
                  { kind: "assertion", text: "Sign out", expectedResult: "Login", deviceLabel: "Phone", marks: ["ROW-2", "ROW-1"] },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.keys).sort()).toEqual(["ROW-1", "ROW-2"]);
    const row1 = res.body.keys["ROW-1"]!;
    const row2 = res.body.keys["ROW-2"]!;
    expect(res.body.tests.map((t) => t.id)).toEqual([row1, row2]);
    expect(res.body.tests[0]!.current.createdBy).toBe("importer");

    const steps = res.body.templates[0]!.flows[0]!.steps;
    expect(steps[0]!.marks).toEqual([]);
    expect(steps[1]!.marks).toEqual([row1]);
    expect(new Set(steps[2]!.marks)).toEqual(new Set([row1, row2]));

    // Coverage sees it immediately: both tests reached by the new template.
    const coverage = await call<{ covered: number; uncovered: number }>(`/api/products/${productId}/coverage`);
    expect(coverage.body.uncovered).toBe(1); // the "by header" test from the identity block
  });

  test("a step may mark a test that already exists, by id", async () => {
    const existing = (await call<Test[]>(`/api/products/${productId}/tests`)).body[0]!;
    const res = await call<ImportResult>(
      `/api/products/${productId}/import`,
      json("POST", {
        templates: [
          {
            name: "Marks an existing test",
            flows: [{ name: "f", steps: [{ kind: "assertion", text: "check", deviceLabel: "A", marks: [existing.id] }] }],
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.templates[0]!.flows[0]!.steps[0]!.marks).toEqual([existing.id]);
  });

  test("an unresolvable mark is a 400 naming the path, and nothing is created", async () => {
    const before = (await call<Template[]>(`/api/products/${productId}/templates`)).body.length;
    const res = await call<{ error: string; details: { path: (string | number)[]; message: string }[] }>(
      `/api/products/${productId}/import`,
      json("POST", {
        tests: [{ key: "A", title: "t", expectedResult: "e" }],
        templates: [
          {
            name: "Broken",
            flows: [{ name: "f", steps: [{ kind: "action", text: "x", deviceLabel: "D", marks: ["A", "NOPE"] }] }],
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.details[0]!.path).toEqual(["templates", 0, "flows", 0, "steps", 0, "marks", 1]);
    expect(res.body.details[0]!.message).toContain("NOPE");

    const after = (await call<Template[]>(`/api/products/${productId}/templates`)).body.length;
    expect(after).toBe(before);
    const titles = (await call<Test[]>(`/api/products/${productId}/tests`)).body.map((t) => t.current.title);
    expect(titles).not.toContain("t");
  });

  test("a duplicate key is a 400", async () => {
    const res = await call<{ details: { path: unknown[] }[] }>(
      `/api/products/${productId}/import`,
      json("POST", {
        tests: [
          { key: "dup", title: "a", expectedResult: "e" },
          { key: "dup", title: "b", expectedResult: "e" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.details[0]!.path).toEqual(["tests", 1, "key"]);
  });

  test("an empty bundle fails validation", async () => {
    const res = await call(`/api/products/${productId}/import`, json("POST", {}));
    expect(res.status).toBe(400);
  });
});

describe("the product as a whole (scripts and agents)", () => {
  test("GET /api is a readable front door", async () => {
    const res = await call<{ openapi: string; identity: { how: string } }>("/api");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("/api/openapi.json");
    expect(res.body.identity.how).toContain("X-Flowdeck-Actor");
  });

  test("export is a valid import: a suite round-trips into a new product", async () => {
    const seeded = await call<ImportResult>(`/api/products/${productId}/import`, json("POST", {
      tests: [
        { key: "a", title: "Round trip A", expectedResult: "A holds", metadata: { tags: ["rt"] } },
        { key: "b", title: "Round trip B", expectedResult: "B holds", archived: true },
      ],
      templates: [{
        name: "Round trip", status: "active",
        flows: [{ name: "Only flow", precondition: "Fresh", estimatedMinutes: 5, archived: false, steps: [
          { kind: "action", text: "Do it", deviceLabel: "Phone", marks: ["a"] },
          { kind: "assertion", text: "Check it", expectedResult: "Fine", postState: "Home", deviceLabel: "Phone", marks: ["a", "b"] },
        ] }],
      }],
    }));
    expect(seeded.status).toBe(201);

    const exported = await call<{ product: { id: string }; tests: { key: string; title: string; archived: boolean }[]; templates: { flows: { steps: { marks: string[] }[] }[] }[] }>(`/api/products/${productId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body.product.id).toBe(productId);
    const b = exported.body.tests.find((t) => t.title === "Round trip B")!;
    expect(b.archived).toBe(true);
    expect(b.key).toBe(seeded.body.keys.b!);

    const other = await call<{ id: string }>("/api/products", json("POST", { name: `export-target-${Date.now()}` }));
    try {
      const re = await call<ImportResult>(`/api/products/${other.body.id}/import`, json("POST", { tests: exported.body.tests, templates: exported.body.templates }));
      expect(re.status).toBe(201);
      const again = await call<typeof exported.body>(`/api/products/${other.body.id}/export`);
      const strip = (x: typeof exported.body) => ({
        tests: x.tests.map(({ key: _, ...t }) => t).sort((p, q) => p.title.localeCompare(q.title)),
        templates: x.templates.map((t) => ({ ...t, flows: t.flows.map((f) => ({ ...f, steps: f.steps.map((s) => ({ ...s, marks: s.marks.length })) })) })),
      });
      expect(strip(again.body)).toEqual(strip(exported.body));
    } finally {
      const gone = await call(`/api/products/${other.body.id}?confirm=true`, { method: "DELETE", headers: { "x-flowdeck-actor": "importer" } });
      expect(gone.status).toBe(204);
    }
  });

  test("a product can be renamed, and deleting one asks for confirmation", async () => {
    const renamed = await call<{ name: string }>(`/api/products/${productId}`, json("PATCH", { name: "renamed-scratch" }));
    expect(renamed.body.name).toBe("renamed-scratch");
    const refused = await call<{ error: string }>(`/api/products/${productId}`, { method: "DELETE", headers: { "x-flowdeck-actor": "importer" } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("confirm=true");
  });

  test("a template with no runs can be deleted; one with runs cannot", async () => {
    const [tpl] = (await call<Template[]>(`/api/products/${productId}/templates`, json("POST", { templates: [{ name: "Deletable", flows: [] }] }))).body;
    const flow = await call<{ id: string; steps: unknown[] }>(`/api/templates/${tpl!.id}/flows`, json("POST", { name: "F", steps: [{ kind: "action", text: "x", deviceLabel: "d" }] }));
    expect((await call<{ id: string }>(`/api/flows/${flow.body.id}`)).body.id).toBe(flow.body.id);

    const run = await call<{ id: string }>(`/api/templates/${tpl!.id}/runs`, json("POST", {}));
    expect(run.status).toBe(201);
    const blocked = await call(`/api/templates/${tpl!.id}`, { method: "DELETE", headers: { "x-flowdeck-actor": "importer" } });
    expect(blocked.status).toBe(409);
    await sql`delete from run where id = ${run.body.id}`;
    const gone = await call(`/api/templates/${tpl!.id}`, { method: "DELETE", headers: { "x-flowdeck-actor": "importer" } });
    expect(gone.status).toBe(204);
  });
});
