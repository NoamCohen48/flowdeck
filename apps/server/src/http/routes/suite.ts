/**
 * A product's suite as one document: read it, plan a change, push it.
 *
 * This is how an agent or the CLI authors. The granular routes stay for the
 * app's editor, which changes one step at a time while someone watches; a suite
 * push is the other shape of work — edit many files, then land them together,
 * with a plan first and a refusal if someone else moved the suite meanwhile.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { findProduct } from "../../db/queries.ts";
import { getSuite, planPush, pushSuite } from "../../suite/service.ts";
import { ErrorSchema, PushResultSchema, PushSuiteSchema, SuiteDocumentSchema, SuitePlanSchema, SuiteSchema } from "../schemas.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const suite = createRouter();

const err = (description: string) => ({ content: { "application/json": { schema: ErrorSchema } }, description });
export const ProductRef = z.string().min(1).max(64).openapi({ description: "The product's id or its slug", example: "relay" });

suite.openapi(
  createRoute({
    method: "get",
    path: "/products/{product}/suite",
    tags: ["Suite"],
    summary: "The whole suite, as one document",
    description:
      "Every test, template, flow and step, addressed by key. Archived templates and flows are included and say so; an archived test is included only while a step still verifies it. " +
      "Keep `revision` — a push names it as `baseRevision`.",
    request: {
      params: z.object({ product: ProductRef }),
      query: z.object({ download: z.enum(["true", "false"]).default("false").openapi({ description: "Adds a Content-Disposition so a browser saves it as a file" }) }),
    },
    responses: {
      200: { content: { "application/json": { schema: SuiteDocumentSchema } }, description: "The suite and its revision" },
      404: err("No such product"),
    },
  }),
  async (c) => {
    const p = await findProduct(c.req.valid("param").product);
    const doc = p && (await getSuite(p.id));
    if (!p || !doc) return c.json({ error: "no such product" }, 404);
    if (c.req.valid("query").download === "true") {
      c.header("content-disposition", `attachment; filename="${p.slug}-${new Date().toISOString().slice(0, 10)}.suite.json"`);
    }
    return c.json(doc, 200);
  },
);

suite.openapi(
  createRoute({
    method: "post",
    path: "/products/{product}/suite/plan",
    tags: ["Suite"],
    summary: "What pushing this suite would change",
    description:
      "Changes nothing. Lists each change (`+` created or restored, `~` edited, `-` archived) and the warnings. " +
      "Errors — a bad key, a step verifying a test that does not exist — make it a 400 with each problem in `details`, by path.",
    request: {
      params: z.object({ product: ProductRef }),
      body: { content: { "application/json": { schema: SuiteSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: SuitePlanSchema } }, description: "The plan" },
      400: err("The suite has errors; `details` lists them"),
      404: err("No such product"),
    },
  }),
  async (c) => {
    const p = await findProduct(c.req.valid("param").product);
    const out = p && (await planPush(p.id, c.req.valid("json")));
    if (!out) return c.json({ error: "no such product" }, 404);
    if ("invalid" in out) return c.json({ error: "the suite has errors", details: out.invalid }, 400);
    return c.json(out, 200);
  },
);

suite.openapi(
  createRoute({
    method: "put",
    path: "/products/{product}/suite",
    tags: ["Suite"],
    summary: "Replace the suite",
    description:
      "In one transaction. Matched by key: new keys are created, edited tests get a new version (the old one stays), and anything the document leaves out is archived — never deleted — so pushing it back restores it. " +
      "Steps keep their ids where their content survives. Results already recorded are untouched: a testing day reads its own snapshot. " +
      "Refused with 409 when the suite changed since `baseRevision`; pull again, or send `force`.",
    request: {
      params: z.object({ product: ProductRef }),
      body: { content: { "application/json": { schema: PushSuiteSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: PushResultSchema } }, description: "What changed, and the new revision" },
      400: err("The suite has errors; `details` lists them"),
      401: err("No identity on the request"),
      404: err("No such product"),
      409: { content: { "application/json": { schema: ErrorSchema.extend({ revision: z.string() }) } }, description: "The suite changed since `baseRevision`; `revision` is the current one" },
    },
  }),
  async (c) => {
    const actor = requireActor(c);
    const p = await findProduct(c.req.valid("param").product);
    if (!p) return c.json({ error: "no such product" }, 404);
    const out = await pushSuite(p.id, c.req.valid("json"), actor);
    if (out.ok) {
      const { ok: _, ...body } = out;
      return c.json(body, 200);
    }
    switch (out.reason) {
      case "invalid": return c.json({ error: "the suite has errors", details: out.problems }, 400);
      case "stale": return c.json({ error: "the suite changed since your base revision: pull, merge, push again (or force)", revision: out.revision }, 409);
      case "missing": return c.json({ error: "no such product" }, 404);
    }
  },
);
