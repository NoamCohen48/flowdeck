/**
 * The public REST API.
 *
 * This is a product surface: adapters, the CLI and
 * import scripts code against it. The OpenAPI document is derived from the same Zod
 * schemas that validate requests, so it cannot drift from the behaviour — and the
 * web app consumes a client generated from that document rather than a second,
 * private API.
 */
import { ZodError } from "zod";
import { ActorRequiredError } from "./actor.ts";
import { BadKeyError, KeyTakenError } from "../db/keys.ts";
import { pgErrorCode } from "../db/client.ts";
import { createRouter } from "./router.ts";
import { products } from "./routes/products.ts";
import { tests } from "./routes/tests.ts";
import { templates } from "./routes/templates.ts";
import { runs } from "./routes/runs.ts";
import { attachments } from "./routes/attachments.ts";
import { authoring } from "./routes/authoring.ts";
import { reports } from "./routes/reports.ts";
import { suite } from "./routes/suite.ts";
import { suites } from "./routes/suites.ts";
import { version } from "../../../../package.json" with { type: "json" };

/** Validation failures name the field; see `router.ts` for why that is shared. */
export const api = createRouter();

api.route("/products", products);
api.route("/", tests);
api.route("/", templates);
api.route("/", runs);
api.route("/", attachments);
api.route("/", authoring);
api.route("/", reports);
api.route("/", suite);
api.route("/", suites);

api.onError((error, c) => {
  if (error instanceof ActorRequiredError) {
    return c.json({ error: error.message }, 401);
  }
  if (error instanceof BadKeyError) {
    return c.json({ error: error.message }, 400);
  }
  // A unique key or slug: asked for explicitly, or set by a PATCH.
  if (error instanceof KeyTakenError || pgErrorCode(error) === "23505") {
    return c.json({ error: error instanceof KeyTakenError ? error.message : "that key or slug is already taken" }, 409);
  }
  if (error instanceof ZodError) {
    return c.json({ error: "invalid data", details: error.issues }, 400);
  }
  console.error(error);
  return c.json({ error: "internal error" }, 500);
});

/**
 * How a caller identifies itself: the signed cookie `PUT /api/me` sets, or —
 * for scripts with no cookie jar — the `X-Flowdeck-Actor` header on every request.
 * Both are a name picker, not authentication; the document says so rather than
 * implying a secret exists.
 */
api.openAPIRegistry.registerComponent("securitySchemes", "actorHeader", {
  type: "apiKey",
  in: "header",
  name: "X-Flowdeck-Actor",
  description:
    "The name every write is attributed to. Not a secret and not authentication — Flowdeck is a name picker. Required on every write; ignored on reads.",
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
    version,
    description:
      "Manual testing as human flows. A test says what must be true; a flow says what a human does. " +
      "Flowdeck integrates with nothing directly — it emits structured data and accepts structured data, " +
      "and adapters written outside it decide what becomes a ticket.",
  },
  // Either scheme identifies the caller. Typed explicitly: as a bare literal TypeScript
  // infers `{ actorCookie?: undefined }` on the other entry, which a requirement may not hold.
  security: [{ actorHeader: [] }, { actorCookie: [] }] as Record<string, string[]>[],
  servers: [{ url: "/api", description: "Relative to the Flowdeck origin" }],
  tags: [
    { name: "Products", description: "Independent systems under test" },
    { name: "Tests", description: "Assertions, versioned and never hard-deleted" },
    { name: "Templates", description: "Reusable testing days, one per setup" },
    { name: "Suite", description: "A whole product as one document, by key: read it, plan a change, push it. How agents and the CLI author" },
    { name: "Suites", description: "Suite snapshots saved as plain JSON in the backup bucket, and brought back" },
    { name: "Coverage", description: "Is every test reachable by some flow?" },
    { name: "Runs", description: "Testing days: claiming, verdicts, blocking" },
    { name: "Identity", description: "The name picker, and presence" },
  ],
};

api.doc("/openapi.json", openApiConfig);

/**
 * The front door for a script or an agent that only has the origin: what this
 * is, how to identify, where the contract lives, and the handful of routes that
 * cover most jobs. Everything here is also in the OpenAPI document; this is the
 * short version a caller can read in one request.
 */
api.get("/", (c) =>
  c.json({
    name: "Flowdeck",
    version: openApiConfig.info.version,
    description: "Manual testing as human flows. Tests are assertions; flows are what a person does; a run is a testing day.",
    openapi: "/api/openapi.json",
    identity: {
      how: "Send `X-Flowdeck-Actor: <your name>` on every write. Reads need nothing. There are no tokens or passwords.",
      check: "GET /api/me",
    },
    start: {
      products: "GET /api/products",
      createProduct: "POST /api/products { name, description? }",
      cli: "The `flowdeck` CLI wraps the suite routes below: pull a product to files, edit, `flowdeck push --plan`, push. `flowdeck guide` explains how to write tests and flows.",
      suite: "GET /api/products/{product}/suite — the whole suite by key, plus its revision. {product} is the id or the slug",
      plan: "POST /api/products/{product}/suite/plan <suite> — what a push would change, and the lint warnings; changes nothing",
      push: "PUT /api/products/{product}/suite { baseRevision, suite } — replaces the suite; what it leaves out is archived, never deleted",
      backupBucket: "GET /api/suites — snapshots saved to the S3 backup bucket; POST /api/products/{productId}/suites saves one; POST /api/suites/{id}/restore brings one back",
      coverage: "GET /api/products/{productId}/coverage",
      startRun: "POST /api/templates/{templateId}/runs",
      issues: "GET /api/runs/{runId}/issues — every failure, self-contained",
    },
    errors: "Every error is { error: string, details?: [...] }. 400 names the field; 401 means no identity; 409 asks for a confirmation query (?confirm=true, ?force=true).",
  }),
);
