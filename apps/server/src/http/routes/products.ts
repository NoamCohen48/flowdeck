import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { product } from "../../db/schema.ts";
import { createProduct, findProduct, listProducts } from "../../db/queries.ts";
import {
  CreateProductSchema,
  ErrorSchema,
  ProductSchema,
  UpdateProductSchema,
} from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";
import { ProductRef } from "./suite.ts";

export const products = createRouter();

products.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Products"],
    summary: "List products",
    description:
      "Products are fully independent — different systems, different teams, no shared data.",
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
    path: "/{product}",
    tags: ["Products"],
    summary: "Get one product, by id or slug",
    request: { params: z.object({ product: ProductRef }) },
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
    const row = await findProduct(c.req.valid("param").product);
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
    return c.json(await createProduct(c.req.valid("json")), 201);
  },
);

products.openapi(
  createRoute({
    method: "patch",
    path: "/{product}",
    tags: ["Products"],
    summary: "Rename or describe a product",
    request: {
      params: z.object({ product: ProductRef }),
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
    const found = await findProduct(c.req.valid("param").product);
    const [row] = found ? await db.update(product).set(c.req.valid("json")).where(eq(product.id, found.id)).returning() : [];
    return row ? c.json(row, 200) : c.json({ error: "no such product" }, 404);
  },
);

products.openapi(
  createRoute({
    method: "delete",
    path: "/{product}",
    tags: ["Products"],
    summary: "Delete a product and everything in it",
    description:
      "Irreversible: tests, templates, runs, results and attachment records all go. Meant for wiping a product while an import script is still being debugged. Requires `?confirm=true`, since there is no undo and no archive at this level.",
    request: {
      params: z.object({ product: ProductRef }),
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
    const found = await findProduct(c.req.valid("param").product);
    const [row] = found ? await db.delete(product).where(eq(product.id, found.id)).returning() : [];
    return row ? c.body(null, 204) : c.json({ error: "no such product" }, 404);
  },
);
