/**
 * Suite snapshots in the backup bucket: save a product's export there, list what
 * is there, bring one back — into the product it came from or a new one. Plain
 * JSON objects beside the restic repository; see `suites.ts` for why.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { getProduct, createProduct, deleteProduct } from "../../db/queries.ts";
import { deleteSuite, listSuites, readSuite, saveSuite, suiteStoreStatus } from "../../suites.ts";
import { ErrorSchema, ExportBundleSchema, ImportBundleSchema, ImportProductResultSchema, ImportResultSchema, ProductSchema, Uuid } from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";
import { exportProduct } from "./products.ts";
import { importBundle } from "./import.ts";

export const suites = createRouter();

const err = (description: string) => ({ content: { "application/json": { schema: ErrorSchema } }, description });
const unavailable = err("No backup bucket is configured (BACKUP_REPOSITORY and the S3 key pair)");

const SuiteEntrySchema = z
  .object({
    id: z.string(),
    productId: Uuid,
    productName: z.string(),
    savedAt: z.string(),
    savedBy: z.string(),
    bytes: z.number().int(),
    tests: z.number().int(),
    templates: z.number().int(),
  })
  .openapi("SuiteEntry");

const SuiteId = z.string().regex(/^[0-9TZ:.-]+_[0-9a-f-]{36}$/);

suites.openapi(
  createRoute({
    method: "get",
    path: "/suites/status",
    tags: ["Suites"],
    summary: "Is a backup bucket configured for suite snapshots?",
    responses: {
      200: { content: { "application/json": { schema: z.object({ available: z.boolean(), where: z.string().nullable() }).openapi("SuiteStoreStatus") } }, description: "Whether saving to the bucket is possible, and where it points" },
    },
  }),
  (c) => c.json(suiteStoreStatus(), 200),
);

suites.openapi(
  createRoute({
    method: "get",
    path: "/suites",
    tags: ["Suites"],
    summary: "Suite snapshots in the backup bucket, newest first",
    request: { query: z.object({ productId: Uuid.optional() }) },
    responses: {
      200: { content: { "application/json": { schema: z.array(SuiteEntrySchema) } }, description: "Every snapshot, or only one product's" },
      503: unavailable,
    },
  }),
  async (c) => {
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    return c.json(await listSuites(c.req.valid("query").productId), 200);
  },
);

suites.openapi(
  createRoute({
    method: "post",
    path: "/products/{productId}/suites",
    tags: ["Suites"],
    summary: "Save a product's suite to the backup bucket",
    description: "Writes `GET /products/{productId}/export` as one JSON object under `suites/` in the bucket. Attributed to the caller.",
    request: { params: z.object({ productId: Uuid }) },
    responses: {
      201: { content: { "application/json": { schema: SuiteEntrySchema } }, description: "Saved" },
      401: err("No identity on the request"),
      404: err("No such product"),
      503: unavailable,
    },
  }),
  async (c) => {
    const who = requireActor(c);
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    const bundle = await exportProduct(c.req.valid("param").productId);
    if (!bundle) return c.json({ error: "no such product" }, 404);
    return c.json(await saveSuite(bundle, who), 201);
  },
);

suites.openapi(
  createRoute({
    method: "get",
    path: "/suites/{suiteId}",
    tags: ["Suites"],
    summary: "One snapshot's contents — an export bundle",
    request: { params: z.object({ suiteId: SuiteId }) },
    responses: {
      200: { content: { "application/json": { schema: ExportBundleSchema } }, description: "The bundle as saved" },
      404: err("No such snapshot"),
      503: unavailable,
    },
  }),
  async (c) => {
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    const doc = await readSuite(c.req.valid("param").suiteId);
    if (!doc) return c.json({ error: "no such snapshot" }, 404);
    const { flowdeck: _, ...bundle } = doc;
    return c.json(bundle as z.infer<typeof ExportBundleSchema>, 200);
  },
);

suites.openapi(
  createRoute({
    method: "post",
    path: "/suites/{suiteId}/import",
    tags: ["Suites", "Import"],
    summary: "Import a snapshot into an existing product, or a new one",
    description:
      "`{ into: <productId> }` adds the snapshot's tests and templates to that product (creating, not merging — same as any import). `{ into: \"new\", name? }` creates a product from it, named after the original unless `name` says otherwise.",
    request: {
      params: z.object({ suiteId: SuiteId }),
      body: { content: { "application/json": { schema: z.object({ into: z.union([Uuid, z.literal("new")]), name: z.string().min(1).optional() }).openapi("ImportSuite") } } },
    },
    responses: {
      201: { content: { "application/json": { schema: ImportProductResultSchema } }, description: "What was created; `product` is the one it went into" },
      400: err("The snapshot does not resolve against that product"),
      401: err("No identity on the request"),
      404: err("No such snapshot or product"),
      503: unavailable,
    },
  }),
  async (c) => {
    const who = requireActor(c);
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    const doc = await readSuite(c.req.valid("param").suiteId);
    if (!doc) return c.json({ error: "no such snapshot" }, 404);
    const { into, name } = c.req.valid("json");
    const parsed = ImportBundleSchema.safeParse({ tests: doc.tests, templates: doc.templates });
    if (!parsed.success) return c.json({ error: "the snapshot is not a valid bundle", details: parsed.error.issues }, 400);

    if (into === "new") {
      const created = await createProduct({ name: name ?? doc.product.name, description: doc.product.description });
      const out = await importBundle(created.id, parsed.data, who);
      if ("issues" in out) {
        await deleteProduct(created.id);
        return c.json({ error: "the snapshot does not resolve", details: out.issues }, 400);
      }
      return c.json({ product: created, ...out.result }, 201);
    }
    const target = await getProduct(into);
    if (!target) return c.json({ error: "no such product" }, 404);
    const out = await importBundle(into, parsed.data, who);
    if ("issues" in out) return c.json({ error: "the snapshot does not resolve", details: out.issues }, 400);
    return c.json({ product: target, ...out.result }, 201);
  },
);

suites.openapi(
  createRoute({
    method: "delete",
    path: "/suites/{suiteId}",
    tags: ["Suites"],
    summary: "Remove a snapshot from the bucket",
    request: { params: z.object({ suiteId: SuiteId }) },
    responses: {
      204: { description: "Removed" },
      401: err("No identity on the request"),
      404: err("No such snapshot"),
      503: unavailable,
    },
  }),
  async (c) => {
    requireActor(c);
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    return (await deleteSuite(c.req.valid("param").suiteId)) ? c.body(null, 204) : c.json({ error: "no such snapshot" }, 404);
  },
);
