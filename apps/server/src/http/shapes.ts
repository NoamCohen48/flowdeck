import { Hono } from "hono";
import type { ActorEnv } from "./actor.ts";

/**
 * The Electric shape proxy (D32, D33).
 *
 * Electric is never exposed to the browser directly. Every shape request comes
 * through here, so there is one origin, one place that decides what a client may
 * subscribe to, and no second service on the network edge.
 *
 * The client sends the shape *name* and its parameters, not a table and a where
 * clause — otherwise "authorisation" would mean parsing user-supplied SQL. The
 * allowlist below is the entire set of things anyone can subscribe to.
 */

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? "http://localhost:3010";

/**
 * Parameters Electric owns; the client passes them through untouched on resume.
 * `subset__*` keys (on-demand sync mode) are forwarded by prefix below.
 */
const PASSTHROUGH = ["offset", "handle", "live", "cursor", "cache-buster", "replica", "log"] as const;

type ShapeDefinition = {
  table: string;
  /** Builds the where clause from validated route parameters. */
  where?: (params: Record<string, string>) => string;
  columns?: string[];
  required?: string[];
};

/**
 * Only the live surfaces are here. Authoring, the library, reports and dashboards
 * read through REST, because nothing on a report needs to update while you watch it
 * and an aggregate is one SQL query rather than four shapes reassembled in a browser.
 */
const SHAPES: Record<string, ShapeDefinition> = {
  /** The testing-day board and the runner: who claimed what, how far they got. */
  "run.flow_runs": {
    table: "flow_run",
    required: ["runId"],
    where: (p) => `run_id = '${p.runId}'`,
  },
  /** Verdicts landing live, on the board and on a second tester's screen. */
  "run.results": {
    table: "test_result",
    required: ["runId"],
    where: (p) =>
      `flow_run_id in (select id from flow_run where run_id = '${p.runId}')`,
  },
  /** Steps flagged as wrong (D40), beside the verdicts they sit among. */
  "run.step_problems": {
    table: "step_problem",
    required: ["runId"],
    where: (p) =>
      `flow_run_id in (select id from flow_run where run_id = '${p.runId}')`,
  },
  /** "Dana is editing this flow", "Ori is on this run" (D37). */
  presence: {
    table: "presence",
    required: ["scope"],
    where: (p) => `scope = '${p.scope}'`,
  },
  /**
   * The library's red rows, updating live as an author marks tests.
   *
   * Electric follows logical replication, so it cannot sync a view — the
   * `test_coverage` view serves the REST endpoint, and this shape syncs the raw
   * marks instead. The browser computes covered/uncovered from them with
   * `coverageOf` from @flowdeck/domain, the same rule the API uses. Which
   * templates cover a test (the chips) is not live; that reads through REST.
   */
  "product.marks": {
    table: "step_mark",
    required: ["productId"],
    where: (p) =>
      `test_id in (select id from test where product_id = '${p.productId}')`,
  },
  /** The library itself — titles and archived flags — so a new test appears live. */
  "product.tests": {
    table: "test",
    required: ["productId"],
    where: (p) => `product_id = '${p.productId}'`,
  },
  /** A second author watching a flow change under them (D37). */
  "flow.steps": {
    table: "step",
    required: ["flowId"],
    where: (p) => `flow_id = '${p.flowId}'`,
  },
  /** The marks of one flow's steps, so the editor's test rows move live too. */
  "flow.marks": {
    table: "step_mark",
    required: ["flowId"],
    where: (p) => `step_id in (select id from step where flow_id = '${p.flowId}')`,
  },
};

/**
 * Route parameters are interpolated into a where clause, so they are restricted to
 * the shape of the identifiers they are allowed to be. This is the only place user
 * input reaches SQL text rather than a bound parameter, and it is deliberately
 * narrow: UUIDs, and scope strings of the form `run:<uuid>`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE = /^(run|flow|template):[0-9a-f-]{36}$/i;

function validate(key: string, value: string): boolean {
  return key === "scope" ? SCOPE.test(value) : UUID.test(value);
}

export const shapes = new Hono<ActorEnv>();

shapes.get("/:name", async (c) => {
  const name = c.req.param("name");
  const definition = SHAPES[name];
  if (!definition) {
    return c.json({ error: `unknown shape: ${name}` }, 404);
  }

  const params: Record<string, string> = {};
  for (const key of definition.required ?? []) {
    const value = c.req.query(key);
    if (!value || !validate(key, value)) {
      return c.json({ error: `shape ${name} requires a valid ${key}` }, 400);
    }
    params[key] = value;
  }

  const upstream = new URL("/v1/shape", ELECTRIC_URL);
  upstream.searchParams.set("table", definition.table);
  if (definition.where) upstream.searchParams.set("where", definition.where(params));
  if (definition.columns) {
    upstream.searchParams.set("columns", definition.columns.join(","));
  }
  for (const key of PASSTHROUGH) {
    const value = c.req.query(key);
    if (value !== undefined) upstream.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(c.req.query())) {
    if (key.startsWith("subset__")) upstream.searchParams.set(key, value);
  }

  const response = await fetch(upstream, {
    headers: { accept: "application/json" },
    // A live shape request long-polls; it must not be cut short by a client abort
    // being misread as a failure.
    signal: AbortSignal.timeout(70_000),
  });

  // Electric's own headers carry the offset and handle the client needs to resume.
  // Strip only the ones that belong to the upstream connection, and pass the rest.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");

  return new Response(response.body, { status: response.status, headers });
});
