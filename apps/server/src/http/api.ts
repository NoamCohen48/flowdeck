/**
 * The public REST API.
 *
 * `.docs/08-api-and-integration.md` treats this as a product surface: adapters and
 * import scripts code against it. The OpenAPI document is derived from the same Zod
 * schemas that validate requests, so it cannot drift from the behaviour — and the
 * web app consumes a client generated from that document rather than a second,
 * private API (D35).
 */
import { ZodError } from "zod";
import { ActorRequiredError } from "./actor.ts";
import { createRouter } from "./router.ts";
import { products } from "./routes/products.ts";
import { tests } from "./routes/tests.ts";
import { templates } from "./routes/templates.ts";
import { runs } from "./routes/runs.ts";
import { attachments } from "./routes/attachments.ts";
import { authoring } from "./routes/authoring.ts";
import { reports } from "./routes/reports.ts";
import { bundle } from "./routes/import.ts";

/** Validation failures name the field; see `router.ts` for why that is shared. */
export const api = createRouter();

api.route("/products", products);
api.route("/", tests);
api.route("/", templates);
api.route("/", runs);
api.route("/", attachments);
api.route("/", authoring);
api.route("/", reports);
api.route("/", bundle);

api.onError((error, c) => {
  if (error instanceof ActorRequiredError) {
    return c.json({ error: error.message }, 401);
  }
  if (error instanceof ZodError) {
    return c.json({ error: "invalid data", details: error.issues }, 400);
  }
  console.error(error);
  return c.json({ error: "internal error" }, 500);
});

/**
 * How a caller identifies itself (D38): the signed cookie `PUT /api/me` sets, or —
 * for scripts with no cookie jar — the `X-Flowdeck-Actor` header on every request.
 * Both are a name picker, not authentication; the document says so rather than
 * implying a secret exists.
 */
api.openAPIRegistry.registerComponent("securitySchemes", "actorHeader", {
  type: "apiKey",
  in: "header",
  name: "X-Flowdeck-Actor",
  description:
    "The name every write is attributed to. Not a secret and not authentication — Flowdeck is a name picker (D38). Required on every write; ignored on reads.",
});
api.openAPIRegistry.registerComponent("securitySchemes", "actorCookie", {
  type: "apiKey",
  in: "cookie",
  name: "flowdeck_actor",
  description: "The signed cookie set by PUT /api/me. What the web app uses.",
});

/** One document config, shared by the live `/api/openapi.json` and `openapi.ts` (the file in `docs/` and the generated client). */
export const openApiConfig = {
  openapi: "3.1.0",
  info: {
    title: "Flowdeck",
    version: "0.1.0",
    description:
      "Manual testing as human flows. A test says what must be true; a flow says what a human does. " +
      "Flowdeck integrates with nothing directly — it emits structured data and accepts structured data, " +
      "and adapters written outside it decide what becomes a ticket.",
  },
  security: [{ actorHeader: [] }, { actorCookie: [] }],
  servers: [{ url: "/api", description: "Relative to the Flowdeck origin" }],
  tags: [
    { name: "Products", description: "Independent systems under test (D23)" },
    { name: "Tests", description: "Assertions, versioned and never hard-deleted" },
    { name: "Templates", description: "Reusable testing days, one per setup" },
    { name: "Import", description: "A whole suite in one request: tests keyed by the caller, templates marking by key" },
    { name: "Coverage", description: "Is every test reachable by some flow?" },
    { name: "Runs", description: "Testing days: claiming, verdicts, blocking" },
    { name: "Identity", description: "The name picker, and presence" },
  ],
};

api.doc("/openapi.json", openApiConfig);
