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
