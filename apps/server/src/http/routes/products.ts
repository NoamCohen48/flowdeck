import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { product } from "../../db/schema.ts";
import { getProduct, listProducts, listTemplatesWithFlows, listTests } from "../../db/queries.ts";
import {
  CreateProductSchema,
  ErrorSchema,
  ExportBundleSchema,
  ProductSchema,
  UpdateProductSchema,
  Uuid,
} from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const products = createRouter();

products.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Products"],
    summary: "List products",
    description:
      "Products are fully independent (D23) — different systems, different teams, no shared data.",
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ProductSchema) } },
        description: "Every product on this instance",
      },
    },
  }),
  async (c) => c.json(await listProducts(), 200),
);

products.openapi(
  createRoute({
    method: "get",
    path: "/{productId}",
    tags: ["Products"],
    summary: "Get one product",
    request: { params: z.object({ productId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: ProductSchema } },
        description: "The product",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such product",
      },
    },
  }),
  async (c) => {
    const row = await getProduct(c.req.valid("param").productId);
    return row ? c.json(row, 200) : c.json({ error: "no such product" }, 404);
  },
);

products.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Products"],
    summary: "Create a product",
    request: {
      body: { content: { "application/json": { schema: CreateProductSchema } } },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ProductSchema } },
        description: "The created product",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No identity on the request",
      },
    },
  }),
  async (c) => {
    requireActor(c);
    const [row] = await db.insert(product).values(c.req.valid("json")).returning();
    return c.json(row!, 201);
  },
);

products.openapi(
  createRoute({
    method: "patch",
    path: "/{productId}",
    tags: ["Products"],
    summary: "Rename or describe a product",
    request: {
      params: z.object({ productId: Uuid }),
      body: { content: { "application/json": { schema: UpdateProductSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: ProductSchema } }, description: "The product" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity on the request" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such product" },
    },
  }),
  async (c) => {
    requireActor(c);
    const [row] = await db.update(product).set(c.req.valid("json")).where(eq(product.id, c.req.valid("param").productId)).returning();
    return row ? c.json(row, 200) : c.json({ error: "no such product" }, 404);
  },
);

products.openapi(
  createRoute({
    method: "delete",
    path: "/{productId}",
    tags: ["Products"],
    summary: "Delete a product and everything in it",
    description:
      "Irreversible: tests, templates, runs, results and attachment records all go. Meant for wiping a product while an import script is still being debugged. Requires `?confirm=true`, since there is no undo and no archive at this level.",
    request: {
      params: z.object({ productId: Uuid }),
      query: z.object({ confirm: z.enum(["true", "false"]).default("false") }),
    },
    responses: {
      204: { description: "Deleted" },
      401: { content: { "application/json": { schema: ErrorSchema } }, description: "No identity on the request" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such product" },
      409: { content: { "application/json": { schema: ErrorSchema } }, description: "`confirm=true` is missing" },
    },
  }),
  async (c) => {
    requireActor(c);
    if (c.req.valid("query").confirm !== "true") {
      return c.json({ error: "deleting a product removes all of its tests, templates and runs; repeat with ?confirm=true" }, 409);
    }
    const [row] = await db.delete(product).where(eq(product.id, c.req.valid("param").productId)).returning();
    return row ? c.body(null, 204) : c.json({ error: "no such product" }, 404);
  },
);

/**
 * The whole product in the shape the import takes, so a script can pull a suite,
 * edit it as a document and push it back — or move it between instances. Test
 * ids double as keys; templates reference them the same way a bundle does.
 */
products.openapi(
  createRoute({
    method: "get",
    path: "/{productId}/export",
    tags: ["Products", "Import"],
    summary: "Export a product as an import bundle",
    description:
      "Every test (archived ones included, flagged) and every template with its flows, steps and marks. The result is a valid body for `POST /products/{productId}/import`: test `key`s are the ids here, and each step's `marks` use them. Runs and results are not part of a suite and are not included — see `GET /runs/{runId}`.",
    request: {
      params: z.object({ productId: Uuid }),
      query: z.object({ download: z.enum(["true", "false"]).default("false").openapi({ description: "Adds a Content-Disposition so a browser saves it as a file" }) }),
    },
    responses: {
      200: { content: { "application/json": { schema: ExportBundleSchema } }, description: "The bundle" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "No such product" },
    },
  }),
  async (c) => {
    const bundle = await exportProduct(c.req.valid("param").productId);
    if (!bundle) return c.json({ error: "no such product" }, 404);
    if (c.req.valid("query").download === "true") {
      c.header("content-disposition", `attachment; filename="${fileNameFor(bundle.product.name)}"`);
    }
    return c.json(bundle, 200);
  },
);

/** The export bundle for a product, or undefined. Also what a suite snapshot stores. */
export async function exportProduct(productId: string) {
  const p = await getProduct(productId);
  if (!p) return undefined;
  const tests = await listTests(productId);
  const templates = await listTemplatesWithFlows(productId);
  return {
    product: { id: p.id, name: p.name, description: p.description },
    tests: tests.map((t) => ({
      key: t.id,
      title: t.current.title,
      expectedResult: t.current.expectedResult,
      metadata: t.current.metadata as Record<string, unknown>,
      archived: t.archived,
    })),
    templates: templates.map((t) => ({
      name: t.name,
      description: t.description,
      status: t.status,
      flows: t.flows.map((f) => ({
        name: f.name,
        precondition: f.precondition,
        estimatedMinutes: f.estimatedMinutes,
        archived: f.archived,
        steps: f.steps.map((s) => ({
          kind: s.kind,
          text: s.text,
          expectedResult: s.expectedResult,
          postState: s.postState,
          deviceLabel: s.deviceLabel,
          marks: s.marks,
        })),
      })),
    })),
  };
}

export function fileNameFor(productName: string) {
  const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  return `flowdeck-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
}
