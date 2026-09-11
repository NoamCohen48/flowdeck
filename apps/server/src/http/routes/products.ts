import { createRoute, z } from "@hono/zod-openapi";
import { db } from "../../db/client.ts";
import { product } from "../../db/schema.ts";
import { getProduct, listProducts } from "../../db/queries.ts";
import {
  CreateProductSchema,
  ErrorSchema,
  ProductSchema,
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
