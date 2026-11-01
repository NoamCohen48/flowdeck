/**
 * Screenshots and photos on failures.
 *
 * Bytes live on a mounted volume, content-addressed by SHA-256, and only the
 * metadata is in Postgres — large binaries stay out of the database and out of
 * the replication stream Electric follows. Content addressing also means the same
 * screenshot attached twice is stored once.
 *
 * Nothing is ever deleted automatically. There is a configurable disk budget and
 * the dashboard warns as it is approached; that is the whole retention policy.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addAttachment, getResult, listAttachments } from "../../db/runs.ts";
import { AttachmentSchema, ErrorSchema, Uuid } from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";
import { db } from "../../db/client.ts";
import { attachment } from "../../db/schema.ts";
import { eq } from "drizzle-orm";

export const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? "./data/attachments";
export const ATTACHMENTS_BUDGET_MB = Number(process.env.ATTACHMENTS_BUDGET_MB ?? 2048);
/** Per file. Clients downscale before upload; this is the backstop. */
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const attachments = createRouter();

function pathFor(sha256: string) {
  return join(ATTACHMENTS_DIR, sha256.slice(0, 2), sha256);
}

export function attachmentDto(row: {
  id: string;
  testResultId: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
}) {
  return { ...row, url: `/api/attachments/${row.id}` };
}

attachments.openapi(
  createRoute({
    method: "post",
    path: "/results/{resultId}/attachments",
    tags: ["Runs"],
    summary: "Attach an image to a result",
    description:
      "Multipart: `file` (image), optional `width` and `height` from the client's own decode. Several per result are fine — before/after, both devices.",
    request: {
      params: z.object({ resultId: Uuid }),
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({
              file: z.any().openapi({ type: "string", format: "binary" }),
              width: z.coerce.number().int().positive().optional(),
              height: z.coerce.number().int().positive().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: { content: { "application/json": { schema: AttachmentSchema } }, description: "Stored" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Not an image, or too large" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such result" },
      507: { content: { "application/json": { schema: ErrorSchema } }, description: "Disk budget exhausted" },
    },
  }),
  async (c) => {
    requireActor(c);
    const { resultId } = c.req.valid("param");
    if (!(await getResult(resultId))) return c.json({ error: "no such result" }, 404);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "a file is required" }, 400);
    if (!ALLOWED.has(file.type)) return c.json({ error: `not an accepted image type: ${file.type}` }, 400);
    if (file.size > MAX_BYTES) return c.json({ error: "file is larger than 15 MB" }, 400);

    const usage = await diskUsage();
    if (usage.usedBytes + file.size > ATTACHMENTS_BUDGET_MB * 1024 * 1024) {
      return c.json({ error: "the attachment disk budget is exhausted" }, 507);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const target = pathFor(sha256);
    await mkdir(join(ATTACHMENTS_DIR, sha256.slice(0, 2)), { recursive: true });
    // Content-addressed: writing the same bytes twice is a no-op.
    if (!(await exists(target))) await writeFile(target, bytes);

    const dims = (k: string) => {
      const v = form.get(k);
      const n = typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const row = await addAttachment({
      testResultId: resultId,
      sha256,
      mime: file.type,
      bytes: file.size,
      width: dims("width"),
      height: dims("height"),
      originalName: file.name || null,
    });
    return c.json(attachmentDto(row), 201);
  },
);

attachments.openapi(
  createRoute({
    method: "get",
    path: "/results/{resultId}/attachments",
    tags: ["Runs"],
    summary: "Images attached to a result",
    request: { params: z.object({ resultId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: z.array(AttachmentSchema) } }, description: "Attachments" },
    },
  }),
  async (c) =>
    c.json((await listAttachments(c.req.valid("param").resultId)).map(attachmentDto), 200),
);

attachments.openapi(
  createRoute({
    method: "get",
    path: "/attachments/usage",
    tags: ["Runs"],
    summary: "Disk used by attachments, against the budget",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              usedBytes: z.number(),
              budgetBytes: z.number(),
              files: z.number(),
              /** True once past 85% — the dashboard's warning threshold. */
              nearBudget: z.boolean(),
            }),
          },
        },
        description: "Usage",
      },
    },
  }),
  async (c) => {
    const u = await diskUsage();
    const budgetBytes = ATTACHMENTS_BUDGET_MB * 1024 * 1024;
    return c.json({ ...u, budgetBytes, nearBudget: u.usedBytes > budgetBytes * 0.85 }, 200);
  },
);

// Plain Hono route: streams the file, with the browser doing the caching.
attachments.get("/attachments/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "no such attachment" }, 404);
  const [row] = await db.select().from(attachment).where(eq(attachment.id, id));
  if (!row) return c.json({ error: "no such attachment" }, 404);
  const file = Bun.file(pathFor(row.sha256));
  if (!(await file.exists())) return c.json({ error: "file missing from disk" }, 404);
  return new Response(file, {
    headers: {
      "content-type": row.mime,
      // Content-addressed and immutable, so this can be cached forever.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function diskUsage() {
  let usedBytes = 0;
  let files = 0;
  try {
    for (const shard of await readdir(ATTACHMENTS_DIR)) {
      for (const name of await readdir(join(ATTACHMENTS_DIR, shard))) {
        usedBytes += (await stat(join(ATTACHMENTS_DIR, shard, name))).size;
        files += 1;
      }
    }
  } catch {
    // No directory yet: nothing stored.
  }
  return { usedBytes, files };
}
