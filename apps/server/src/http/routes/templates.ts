/**
 * Templates and flows.
 *
 * A template is a reusable definition of a testing day for one particular setup,
 * and its test scope is implicit — whatever its flows mark (D1). There is no field
 * in which to declare scope, deliberately: a second list is a second thing to
 * maintain and a second way to be wrong.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { computeHandoffs } from "@flowdeck/domain";
import {
  coverageForProduct,
  createTemplates,
  getProduct,
  getTemplateWithFlows,
  listFlowSteps,
  listTemplateSummaries,
} from "../../db/queries.ts";
import {
  CreateTemplatesSchema,
  ErrorSchema,
  TemplateSchema,
  TemplateSummarySchema,
  Uuid,
} from "../schemas.ts";
import { templateDto } from "../serialize.ts";
import { requireActor } from "../actor.ts";
import { createRouter } from "../router.ts";

export const templates = createRouter();

templates.openapi(
  createRoute({
    method: "get",
    path: "/products/{productId}/templates",
    tags: ["Templates"],
    summary: "List a product's templates",
    description:
      "Several templates per product is the norm — one per setup. Archived templates are included, because they stop appearing in the run picker but keep counting toward coverage (D3).",
    request: { params: z.object({ productId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TemplateSummarySchema) } },
        description: "Templates with their flow and marked-test counts",
      },
    },
  }),
  async (c) => {
    const rows = await listTemplateSummaries(c.req.valid("param").productId);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        name: r.name,
        description: r.description,
        status: r.status,
        flowCount: r.flow_count,
        marksTestCount: r.marks_test_count,
      })),
      200,
    );
  },
);

templates.openapi(
  createRoute({
    method: "get",
    path: "/templates/{templateId}",
    tags: ["Templates"],
    summary: "A template with its flows and steps",
    request: { params: z.object({ templateId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: TemplateSchema } },
        description: "The template",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such template",
      },
    },
  }),
  async (c) => {
    const row = await getTemplateWithFlows(c.req.valid("param").templateId);
    return row
      ? c.json(templateDto(row), 200)
      : c.json({ error: "no such template" }, 404);
  },
);

/**
 * What a template's flows add up to. Reported as information, never as a warning
 * (D1): a template targeting one setup can only reach the tests performable in that
 * setup, so warning per template would fire constantly and be ignored. The warning
 * lives at the product level, where it means something.
 */
const TemplateScopeSchema = z.object({
  templateId: Uuid,
  covers: z.number().int(),
  productTotal: z.number().int(),
  /** Live tests in the product that this template's flows never reach. */
  misses: z.array(Uuid),
});

templates.openapi(
  createRoute({
    method: "get",
    path: "/templates/{templateId}/scope",
    tags: ["Templates", "Coverage"],
    summary: "What this template covers, and what it misses",
    description:
      "The 'covers 20 of 25 tests' line, and the list behind 'see what it misses'. A report, not a form.",
    request: { params: z.object({ templateId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: TemplateScopeSchema } },
        description: "Scope report",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such template",
      },
    },
  }),
  async (c) => {
    const { templateId } = c.req.valid("param");
    const tpl = await getTemplateWithFlows(templateId);
    if (!tpl) return c.json({ error: "no such template" }, 404);

    const marked = new Set(
      tpl.flows.flatMap((f) => f.steps.flatMap((s) => s.marks)),
    );
    const coverage = await coverageForProduct(tpl.productId);
    const live = coverage.filter((r) => !r.archived);

    return c.json(
      {
        templateId,
        covers: marked.size,
        productTotal: live.length,
        misses: live.filter((r) => !marked.has(r.test_id)).map((r) => r.test_id),
      },
      200,
    );
  },
);

/**
 * The device list a tester reads before starting, so they know what hardware to
 * collect. Derived from the steps — never stored — which is also the agreed
 * fallback position for D17 if mid-flow introduction proves disruptive.
 */
const FlowDevicesSchema = z.object({
  flowId: Uuid,
  devices: z.array(
    z.object({
      label: z.string(),
      letter: z.string(),
      slot: z.number().int(),
      introducedAtStepId: Uuid,
      introducedAtIndex: z.number().int(),
    }),
  ),
});

templates.openapi(
  createRoute({
    method: "get",
    path: "/flows/{flowId}/devices",
    tags: ["Templates"],
    summary: "Devices a flow uses, and where each is introduced",
    description:
      "Computed from the step list by @flowdeck/domain, the same function the editor and the runner use. Never stored: a hand-off banner is 'the first step using this device label', and storing it would make every insert and reorder a chance to leave a step orphaned above its own introduction.",
    request: { params: z.object({ flowId: Uuid }) },
    responses: {
      200: {
        content: { "application/json": { schema: FlowDevicesSchema } },
        description: "Devices in order of first appearance",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "No such flow",
      },
    },
  }),
  async (c) => {
    const { flowId } = c.req.valid("param");
    const steps = await listFlowSteps(flowId);
    if (steps.length === 0) return c.json({ error: "no such flow" }, 404);

    const handoffs = computeHandoffs(
      steps.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        kind: s.kind,
        marks: [],
      })),
    );

    return c.json({ flowId, devices: [...handoffs.devices] }, 200);
  },
);

templates.openapi(
  createRoute({
    method: "post",
    path: "/products/{productId}/templates",
    tags: ["Templates"],
    summary: "Bulk-create templates with their flows and steps",
    description:
      "Phase two of an import (D29). Steps reference tests by the IDs returned from phase one, so the importing script holds the mapping rather than Flowdeck knowing anything about the source.",
    request: {
      params: z.object({ productId: Uuid }),
      body: { content: { "application/json": { schema: CreateTemplatesSchema } } },
    },
    responses: {
      201: {
        content: { "application/json": { schema: z.array(TemplateSchema) } },
        description: "The created templates",
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
    requireActor(c);
    const { productId } = c.req.valid("param");
    if (!(await getProduct(productId))) {
      return c.json({ error: "no such product" }, 404);
    }

    const ids = await createTemplates(productId, c.req.valid("json").templates);
    const rows = await Promise.all(ids.map((id) => getTemplateWithFlows(id)));
    return c.json(
      rows.filter((r) => r !== undefined).map(templateDto),
      201,
    );
  },
);
