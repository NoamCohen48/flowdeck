import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor, setActor, type ActorEnv } from "./actor.ts";
import { api } from "./api.ts";
import { query, sql } from "../db/client.ts";
import { sql as raw } from "drizzle-orm";

const app = new Hono<ActorEnv>();
app.use("*", withActor);
app.route("/api", api);

let cookie: string;
let resultId: string;

// A 1×1 PNG. Small, valid, and the same bytes every run — so dedupe is testable.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);

function upload(id: string, file: File, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return app.request(`/api/results/${id}/attachments`, { method: "POST", headers: { cookie }, body: form });
}

beforeAll(async () => {
  const probe = new Hono<ActorEnv>();
  probe.get("/", async (c) => { await setActor(c, "Noa"); return c.text("ok"); });
  cookie = ((await probe.request("/")) as Response).headers.get("set-cookie")!.split(";")[0]!;
  const [r] = await query<{ id: string }>(raw`select id from test_result limit 1`);
  resultId = r!.id;
});

describe("attachments", () => {
  test("an image uploads, is served back byte-for-byte, and is immutable-cacheable", async () => {
    const res = await upload(resultId, new File([PNG], "shot.png", { type: "image/png" }), { width: "1", height: "1" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string; bytes: number; width: number };
    expect(body.bytes).toBe(PNG.byteLength);
    expect(body.width).toBe(1);

    const served = await app.request(body.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  test("the same bytes attached twice share one file on disk", async () => {
    const a = (await (await upload(resultId, new File([PNG], "a.png", { type: "image/png" }))).json()) as { id: string };
    const b = (await (await upload(resultId, new File([PNG], "b.png", { type: "image/png" }))).json()) as { id: string };
    expect(a.id).not.toBe(b.id);
    const rows = await query<{ sha256: string }>(raw`select sha256 from attachment where id in (${a.id}::uuid, ${b.id}::uuid)`);
    expect(new Set(rows.map((r) => r.sha256)).size).toBe(1);
  });

  test("non-images and anonymous uploads are refused", async () => {
    const txt = await upload(resultId, new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(txt.status).toBe(400);
    const form = new FormData();
    form.set("file", new File([PNG], "x.png", { type: "image/png" }));
    const anon = await app.request(`/api/results/${resultId}/attachments`, { method: "POST", body: form });
    expect(anon.status).toBe(401);
  });

  test("a result's attachments are listed with it", async () => {
    const res = await app.request(`/api/results/${resultId}/attachments`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as unknown[];
    expect(list.length).toBeGreaterThanOrEqual(3);
  });
});

process.on("beforeExit", () => void sql.end());
