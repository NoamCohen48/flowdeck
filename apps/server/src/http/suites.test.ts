/**
 * Suite snapshots in the backup bucket. Needs an S3 to talk to, so it runs only
 * when BACKUP_REPOSITORY and the key pair are set (the MinIO from
 * backup/compose.minio.yaml does); otherwise every case is skipped, not failed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { sql } from "../db/client.ts";
import { suiteStoreStatus } from "../suites.ts";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json", "x-flowdeck-actor": "suite-script" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

const configured = suiteStoreStatus().available;
const it = configured ? test : test.skip;

let productId: string;
const cleanup: string[] = [];

beforeAll(async () => {
  const p = await call<{ id: string }>("/api/products", json("POST", { name: `suite-scratch-${Date.now()}` }));
  productId = p.body.id;
  cleanup.push(productId);
  await call(`/api/products/${productId}/suite`, json("PUT", {
    force: true,
    suite: {
      product: { name: `suite-scratch-${Date.now()}` },
      tests: [{ key: "kept", title: "Kept", expect: "Yes" }],
      templates: [{ key: "t", name: "T", flows: [{ key: "f", name: "F", steps: [{ kind: "action", text: "Go", device: "Phone", verifies: ["kept"] }] }] }],
    },
  }));
});

afterAll(async () => {
  for (const id of cleanup) await sql`delete from product where id = ${id}`;
  await sql`delete from actor where name = 'suite-script'`;
});

describe("suite snapshots in the bucket", () => {
  test("status says whether a bucket is configured", async () => {
    const res = await call<{ available: boolean }>("/api/suites/status");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(configured);
  });

  test("without a bucket the routes say so rather than failing oddly", async () => {
    if (configured) return;
    expect((await call("/api/suites")).status).toBe(503);
    expect((await call(`/api/products/${productId}/suites`, json("POST"))).status).toBe(503);
  });

  it("save, list, read, restore into a new product, delete", async () => {
    const saved = await call<{ id: string; productId: string; tests: number; templates: number }>(`/api/products/${productId}/suites`, json("POST"));
    expect(saved.status).toBe(201);
    expect(saved.body.tests).toBe(1);
    expect(saved.body.templates).toBe(1);

    const listed = await call<{ id: string; savedBy: string }[]>(`/api/suites?productId=${productId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.map((s) => s.id)).toContain(saved.body.id);
    expect(listed.body[0]!.savedBy).toBe("suite-script");

    const read = await call<{ revision: string; suite: { tests: { key: string }[] } }>(`/api/suites/${saved.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.suite.tests.map((t) => t.key)).toEqual(["kept"]);

    const restored = await call<{ product: { id: string; name: string }; summary: string[] }>(`/api/suites/${saved.body.id}/restore`, json("POST", { into: "new", name: "Restored copy" }));
    expect(restored.status).toBe(200);
    cleanup.push(restored.body.product.id);
    expect(restored.body.product.name).toBe("Restored copy");
    expect(restored.body.summary).toContain("+ test kept");
    const again = await call<{ suite: { tests: unknown[] } }>(`/api/products/${restored.body.product.id}/suite`);
    expect(again.body.suite.tests).toHaveLength(1);

    const gone = await call(`/api/suites/${saved.body.id}`, json("DELETE"));
    expect(gone.status).toBe(204);
    expect((await call(`/api/suites/${saved.body.id}`)).status).toBe(404);
  });
});
