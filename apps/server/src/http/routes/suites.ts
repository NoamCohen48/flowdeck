/**
 * Suite snapshots in the backup bucket: save a product's suite document there,
 * list what is there, bring one back — over the product it came from or into a
 * new one. Plain JSON objects beside the restic repository; see `suites.ts`.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { createProduct, deleteProduct, findProduct, getProduct } from "../../db/queries.ts";
import { deleteSuite, listSuites, readSuite, saveSuite, suiteStoreStatus } from "../../suites.ts";
import { getSuite, pushSuite } from "../../suite/service.ts";
import { ErrorSchema, ProductSchema, PushResultSchema, SuiteDocumentSchema, Uuid } from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";
import { ProductRef } from "./suite.ts";

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
    description: "Writes `GET /products/{product}/suite` as one JSON object under `suites/` in the bucket. Attributed to the caller.",
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
    const p = await getProduct(c.req.valid("param").productId);
    const doc = p && (await getSuite(p.id));
    if (!p || !doc) return c.json({ error: "no such product" }, 404);
    return c.json(await saveSuite({ productId: p.id, productSlug: p.slug, ...doc }, who), 201);
  },
);

suites.openapi(
  createRoute({
    method: "get",
    path: "/suites/{suiteId}",
    tags: ["Suites"],
    summary: "One snapshot's contents — a suite document",
    request: { params: z.object({ suiteId: SuiteId }) },
    responses: {
      200: { content: { "application/json": { schema: SuiteDocumentSchema } }, description: "The suite as saved, with the revision it had" },
      404: err("No such snapshot"),
      503: unavailable,
    },
  }),
  async (c) => {
    if (!suiteStoreStatus().available) return c.json({ error: "no backup bucket is configured" }, 503);
    const doc = await readSuite(c.req.valid("param").suiteId);
    if (!doc) return c.json({ error: "no such snapshot" }, 404);
    return c.json({ revision: doc.revision, suite: doc.suite }, 200);
  },
);

suites.openapi(
  createRoute({
    method: "post",
    path: "/suites/{suiteId}/restore",
    tags: ["Suites"],
    summary: "Bring a snapshot back, over a product or as a new one",
    description:
      "`{ into: <product id or slug> }` pushes the snapshot over that product, forced: the product's suite becomes the snapshot's, and whatever the snapshot does not have is archived, never deleted. " +
      "`{ into: \"new\", name? }` creates a product from it, named after the original unless `name` says otherwise.",
    request: {
      params: z.object({ suiteId: SuiteId }),
      body: { content: { "application/json": { schema: z.object({ into: z.union([z.literal("new"), ProductRef]), name: z.string().min(1).optional() }).openapi("RestoreSuite") } } },
    },
    responses: {
      200: { content: { "application/json": { schema: PushResultSchema.extend({ product: ProductSchema }).openapi("RestoreResult") } }, description: "What changed; `product` is the one it went into" },
      400: err("The snapshot is not a valid suite"),
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
    const parsed = SuiteDocumentSchema.safeParse({ revision: doc.revision, suite: doc.suite });
    if (!parsed.success) return c.json({ error: "the snapshot is not a valid suite", details: parsed.error.issues }, 400);
    const { into, name } = c.req.valid("json");

    const fresh = into === "new";
    const target = fresh
      ? await createProduct({ name: name ?? parsed.data.suite.product.name, description: parsed.data.suite.product.description ?? "" })
      : await findProduct(into);
    if (!target) return c.json({ error: "no such product" }, 404);
    const suite = fresh ? { ...parsed.data.suite, product: { ...parsed.data.suite.product, name: target.name } } : parsed.data.suite;
    const out = await pushSuite(target.id, { suite, force: true }, who);
    if (!out.ok) {
      if (fresh) await deleteProduct(target.id);
      return out.reason === "invalid"
        ? c.json({ error: "the snapshot has errors", details: out.problems }, 400)
        : c.json({ error: "no such product" }, 404);
    }
    const { ok: _, ...body } = out;
    return c.json({ ...body, product: (await getProduct(target.id))! }, 200);
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
