/**
 * The bundle import: a whole suite in one request.
 *
 * `.docs/08-api-and-integration.md` specifies a two-phase import — create tests,
 * hold the id mapping, create templates whose steps mark those ids. That contract
 * stands (tests.ts, templates.ts). This route is the same thing folded into one
 * transaction for a script that already has everything in hand: tests carry a
 * caller-chosen key, steps mark by key, and the mapping never leaves the server.
 * It is still not idempotent (D29): importing twice creates everything twice.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { db } from "../../db/client.ts";
import {
  createTemplatesIn,
  createTestsIn,
  existingTestIds,
  getProduct,
  getTemplateWithFlows,
  getTest,
} from "../../db/queries.ts";
import {
  ErrorSchema,
  ImportBundleSchema,
  ImportResultSchema,
  Uuid,
  type ImportBundleInput,
} from "../schemas.ts";
import { templateDto, testDto } from "../serialize.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const bundle = createRouter();

type Issue = { path: (string | number)[]; message: string };

/**
 * Every mark must resolve: to a key declared in this bundle, or to a test that
 * already exists in the product. Anything else is reported by position, the
 * same shape the validation hook uses, so a script fixes its parser rather
 * than guessing which of four hundred steps was wrong.
 */
async function resolveMarks(productId: string, input: ImportBundleInput) {
  const issues: Issue[] = [];
  const keys = new Set<string>();
  input.tests.forEach((t, i) => {
    if (keys.has(t.key)) {
      issues.push({ path: ["tests", i, "key"], message: `duplicate key "${t.key}"` });
    }
    keys.add(t.key);
  });

  const referenced = new Set<string>();
  for (const t of input.templates) {
    for (const f of t.flows) {
      for (const s of f.steps) {
        for (const m of s.marks) if (!keys.has(m)) referenced.add(m);
      }
    }
  }
  const idLike = [...referenced].filter((m) => Uuid.safeParse(m).success);
  const existing = await existingTestIds(productId, idLike);

  input.templates.forEach((t, ti) => {
    t.flows.forEach((f, fi) => {
      f.steps.forEach((s, si) => {
        s.marks.forEach((m, mi) => {
          if (keys.has(m) || existing.has(m)) return;
          issues.push({
            path: ["templates", ti, "flows", fi, "steps", si, "marks", mi],
            message: `"${m}" is neither a key in this bundle nor the id of a test in this product`,
          });
        });
      });
    });
  });

  return { issues, keys };
}

bundle.openapi(
  createRoute({
    method: "post",
    path: "/products/{productId}/import",
    tags: ["Import"],
    summary: "Import tests and templates together, in one transaction",
    description:
      "The one-request form of the two-phase import. Each test carries a caller-chosen `key`; steps mark tests by that key (or by the id of a test that already exists in the product). " +
      "Either the whole bundle lands or none of it does. Not idempotent: importing the same bundle twice creates everything twice (D29).",
    request: {
      params: z.object({ productId: Uuid }),
      body: { content: { "application/json": { schema: ImportBundleSchema } } },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ImportResultSchema } },
        description: "What was created, and the key → id mapping",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "A duplicate key, or a mark that resolves to nothing; `details` names each by path",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No identity on the request",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such product",
      },
    },
  }),
  async (c) => {
    const actor = requireActor(c);
    const { productId } = c.req.valid("param");
    if (!(await getProduct(productId))) {
      return c.json({ error: "no such product" }, 404);
    }

    const input = c.req.valid("json");
    const { issues } = await resolveMarks(productId, input);
    if (issues.length > 0) {
      return c.json({ error: "the bundle does not resolve", details: issues }, 400);
    }

    const { keys, testIds, templateIds } = await db.transaction(async (tx) => {
      const created = await createTestsIn(tx, productId, input.tests, actor);
      const keys: Record<string, string> = {};
      input.tests.forEach((t, i) => {
        keys[t.key] = created[i]!.id;
      });
      const templateIds = await createTemplatesIn(
        tx,
        productId,
        input.templates.map((t) => ({
          ...t,
          flows: t.flows.map((f) => ({
            ...f,
            steps: f.steps.map((s) => ({
              ...s,
              marks: s.marks.map((m) => keys[m] ?? m),
            })),
          })),
        })),
      );
      return { keys, testIds: created.map((t) => t.id), templateIds };
    });

    const tests = await Promise.all(testIds.map((id) => getTest(id)));
    const templates = await Promise.all(templateIds.map((id) => getTemplateWithFlows(id)));
    return c.json(
      {
        keys,
        tests: tests.filter((r) => r !== undefined).map(testDto),
        templates: templates.filter((r) => r !== undefined).map(templateDto),
      },
      201,
    );
  },
);
