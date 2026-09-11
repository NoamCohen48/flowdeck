/**
 * Structural editing — the writes behind the template page and the flow editor.
 *
 * Bulk creation (import, D29) lives in templates.ts and tests.ts. These routes
 * are the per-row edits a person makes: one step, one flow, one order. Each
 * returns the transaction id so the editor can reconcile its optimistic state
 * against the Electric stream (`flow.steps`, `flow.marks`).
 */
import { createRoute, z } from "@hono/zod-openapi";
import {
  addMark,
  createFlow,
  deleteFlow,
  deleteStep,
  insertStep,
  removeMark,
  reorderFlows,
  reorderSteps,
  updateFlow,
  updateStep,
  updateTemplate,
  usagesOf,
} from "../../db/authoring.ts";
import { getTemplateWithFlows, getTest, markCountFor } from "../../db/queries.ts";
import {
  CreateFlowSchema,
  ErrorSchema,
  FlowSchema,
  InsertStepSchema,
  ReorderSchema,
  StepWriteSchema,
  TemplateSchema,
  TestUsageSchema,
  TxidSchema,
  UpdateFlowSchema,
  UpdateStepSchema,
  UpdateTemplateSchema,
  Uuid,
} from "../schemas.ts";
import { flowDto, stepDto, templateDto } from "../serialize.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const authoring = createRouter();

const err = (description: string) => ({
  content: { "application/json": { schema: ErrorSchema } },
  description,
});
const unauthorized = err("No identity on the request");

/* ── Templates ───────────────────────────────────────────────────────── */

authoring.openapi(
  createRoute({
    method: "patch",
    path: "/templates/{templateId}",
    tags: ["Templates"],
    summary: "Rename, describe or archive a template",
    description:
      "Archived templates leave the 'start a testing day' picker but keep counting toward coverage.",
    request: {
      params: z.object({ templateId: Uuid }),
      body: { content: { "application/json": { schema: UpdateTemplateSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: TemplateSchema } }, description: "The template" },
      401: unauthorized,
      404: err("No such template"),
    },
  }),
  async (c) => {
    requireActor(c);
    const { templateId } = c.req.valid("param");
    const row = await updateTemplate(templateId, c.req.valid("json"));
    if (!row) return c.json({ error: "no such template" }, 404);
    return c.json(templateDto((await getTemplateWithFlows(templateId))!), 200);
  },
);

authoring.openapi(
  createRoute({
    method: "put",
    path: "/templates/{templateId}/flows/order",
    tags: ["Templates"],
    summary: "Reorder a template's flows",
    request: {
      params: z.object({ templateId: Uuid }),
      body: { content: { "application/json": { schema: ReorderSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Reordered" },
      401: unauthorized,
      409: err("The ids are not exactly this template's flows — someone changed it under you"),
    },
  }),
  async (c) => {
    requireActor(c);
    const { templateId } = c.req.valid("param");
    const done = await reorderFlows(templateId, c.req.valid("json").ids);
    if (!done) return c.json({ error: "ids do not match the template's flows" }, 409);
    return c.json(done, 200);
  },
);

/* ── Flows ───────────────────────────────────────────────────────────── */

authoring.openapi(
  createRoute({
    method: "post",
    path: "/templates/{templateId}/flows",
    tags: ["Templates"],
    summary: "Add a flow to a template",
    request: {
      params: z.object({ templateId: Uuid }),
      body: { content: { "application/json": { schema: CreateFlowSchema } } },
    },
    responses: {
      201: { content: { "application/json": { schema: FlowSchema } }, description: "The new flow" },
      401: unauthorized,
      404: err("No such template"),
    },
  }),
  async (c) => {
    requireActor(c);
    const { templateId } = c.req.valid("param");
    if (!(await getTemplateWithFlows(templateId))) return c.json({ error: "no such template" }, 404);
    const { steps, ...input } = c.req.valid("json");
    const row = await createFlow(templateId, input);
    const created = [];
    for (const [i, s] of steps.entries()) created.push((await insertStep(row.id, i, s)).row);
    return c.json(flowDto({ ...row, steps: created }), 201);
  },
);

authoring.openapi(
  createRoute({
    method: "patch",
    path: "/flows/{flowId}",
    tags: ["Templates"],
    summary: "Edit a flow's name, precondition or estimate",
    request: {
      params: z.object({ flowId: Uuid }),
      body: { content: { "application/json": { schema: UpdateFlowSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: FlowSchema.omit({ steps: true }) } }, description: "The flow" },
      401: unauthorized,
      404: err("No such flow"),
    },
  }),
  async (c) => {
    requireActor(c);
    const row = await updateFlow(c.req.valid("param").flowId, c.req.valid("json"));
    if (!row) return c.json({ error: "no such flow" }, 404);
    const { steps: _, ...dto } = flowDto({ ...row, steps: [] });
    return c.json(dto, 200);
  },
);

authoring.openapi(
  createRoute({
    method: "delete",
    path: "/flows/{flowId}",
    tags: ["Templates"],
    summary: "Delete a flow and its steps",
    description:
      "Runs already started keep their snapshot (D21), so nothing historical is lost. Marks vanish with the steps, which can uncover tests — the template page reports that.",
    request: { params: z.object({ flowId: Uuid }) },
    responses: {
      204: { description: "Deleted" },
      401: unauthorized,
      404: err("No such flow"),
    },
  }),
  async (c) => {
    requireActor(c);
    const gone = await deleteFlow(c.req.valid("param").flowId);
    if (!gone) return c.json({ error: "no such flow" }, 404);
    return c.body(null, 204);
  },
);

/* ── Steps ───────────────────────────────────────────────────────────── */

authoring.openapi(
  createRoute({
    method: "post",
    path: "/flows/{flowId}/steps",
    tags: ["Templates"],
    summary: "Insert a step at a position",
    description:
      "Insert anywhere (07 §1): the step takes the given index and what was there moves down. Hand-off banners are derived from order, so they follow automatically.",
    request: {
      params: z.object({ flowId: Uuid }),
      body: { content: { "application/json": { schema: InsertStepSchema } } },
    },
    responses: {
      201: { content: { "application/json": { schema: StepWriteSchema } }, description: "The new step and its transaction" },
      401: unauthorized,
      404: err("No such flow"),
    },
  }),
  async (c) => {
    requireActor(c);
    const { flowId } = c.req.valid("param");
    const { position, ...input } = c.req.valid("json");
    try {
      const { row, txid } = await insertStep(flowId, position, input);
      return c.json({ step: stepDto(row), txid }, 201);
    } catch (e) {
      if (isForeignKeyViolation(e)) return c.json({ error: "no such flow or test" }, 404);
      throw e;
    }
  },
);

authoring.openapi(
  createRoute({
    method: "patch",
    path: "/steps/{stepId}",
    tags: ["Templates"],
    summary: "Edit one step",
    description: "Last write wins per step (D37). Changing kind to action drops the expected result.",
    request: {
      params: z.object({ stepId: Uuid }),
      body: { content: { "application/json": { schema: UpdateStepSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: StepWriteSchema } }, description: "The step as saved" },
      401: unauthorized,
      404: err("No such step"),
    },
  }),
  async (c) => {
    requireActor(c);
    try {
      const done = await updateStep(c.req.valid("param").stepId, c.req.valid("json"));
      if (!done) return c.json({ error: "no such step" }, 404);
      return c.json({ step: stepDto(done.row), txid: done.txid }, 200);
    } catch (e) {
      if (isForeignKeyViolation(e)) return c.json({ error: "no such test" }, 404);
      throw e;
    }
  },
);

authoring.openapi(
  createRoute({
    method: "delete",
    path: "/steps/{stepId}",
    tags: ["Templates"],
    summary: "Delete a step",
    request: { params: z.object({ stepId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Deleted" },
      401: unauthorized,
      404: err("No such step"),
    },
  }),
  async (c) => {
    requireActor(c);
    const done = await deleteStep(c.req.valid("param").stepId);
    if (!done) return c.json({ error: "no such step" }, 404);
    return c.json({ txid: done.txid }, 200);
  },
);

authoring.openapi(
  createRoute({
    method: "put",
    path: "/flows/{flowId}/steps/order",
    tags: ["Templates"],
    summary: "Reorder a flow's steps",
    description:
      "The whole order in one transaction. Rejected unless the ids are exactly the flow's steps, which is what a drag against a flow someone else just edited looks like — the client re-syncs and the author drags again.",
    request: {
      params: z.object({ flowId: Uuid }),
      body: { content: { "application/json": { schema: ReorderSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Reordered" },
      401: unauthorized,
      409: err("The ids are not exactly this flow's steps"),
    },
  }),
  async (c) => {
    requireActor(c);
    const done = await reorderSteps(c.req.valid("param").flowId, c.req.valid("json").ids);
    if (!done) return c.json({ error: "ids do not match the flow's steps" }, 409);
    return c.json(done, 200);
  },
);

/* ── Marks ───────────────────────────────────────────────────────────── */

authoring.openapi(
  createRoute({
    method: "put",
    path: "/steps/{stepId}/marks/{testId}",
    tags: ["Templates", "Coverage"],
    summary: "Mark a test on a step",
    description: "Idempotent. The same test may be marked on any number of steps (D19).",
    request: { params: z.object({ stepId: Uuid, testId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Marked" },
      401: unauthorized,
      404: err("No such step or test"),
    },
  }),
  async (c) => {
    requireActor(c);
    const { stepId, testId } = c.req.valid("param");
    try {
      return c.json(await addMark(stepId, testId), 200);
    } catch (e) {
      if (isForeignKeyViolation(e)) return c.json({ error: "no such step or test" }, 404);
      throw e;
    }
  },
);

authoring.openapi(
  createRoute({
    method: "delete",
    path: "/steps/{stepId}/marks/{testId}",
    tags: ["Templates", "Coverage"],
    summary: "Unmark a test from a step",
    request: { params: z.object({ stepId: Uuid, testId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: TxidSchema } }, description: "Unmarked (or was never marked)" },
      401: unauthorized,
    },
  }),
  async (c) => {
    requireActor(c);
    const { stepId, testId } = c.req.valid("param");
    return c.json(await removeMark(stepId, testId), 200);
  },
);

/* ── Where a test is verified ────────────────────────────────────────── */

const UsageReportSchema = z.object({
  steps: z.number().int(),
  flows: z.number().int(),
  templates: z.number().int(),
  usages: z.array(TestUsageSchema),
});

authoring.openapi(
  createRoute({
    method: "get",
    path: "/tests/{testId}/usages",
    tags: ["Tests", "Coverage"],
    summary: "Every step that marks this test",
    description:
      "Answers 'if I change this, what am I affecting?' (04), and gives the archive confirmation its numbers before anything happens (D24).",
    request: { params: z.object({ testId: Uuid }) },
    responses: {
      200: { content: { "application/json": { schema: UsageReportSchema } }, description: "Usage report" },
      404: err("No such test"),
    },
  }),
  async (c) => {
    const { testId } = c.req.valid("param");
    if (!(await getTest(testId))) return c.json({ error: "no such test" }, 404);
    const [counts, usages] = await Promise.all([markCountFor(testId), usagesOf(testId)]);
    return c.json({ ...counts, usages }, 200);
  },
);

function isForeignKeyViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23503";
}
