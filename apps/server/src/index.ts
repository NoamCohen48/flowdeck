/**
 * Flowdeck server. One origin: the REST API, the Electric shape proxy, the
 * attachment store, and (in production) the built frontend.
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { db, sql } from "./db/client.ts";
import { sql as raw } from "drizzle-orm";
import { withActor, type ActorEnv } from "./http/actor.ts";
import { shapes } from "./http/shapes.ts";
import { api } from "./http/api.ts";

const app = new Hono<ActorEnv>();

app.use("*", logger());
app.use("*", withActor);

app.get("/health", async (c) => {
  const started = performance.now();
  try {
    await db.execute(raw`select 1`);
  } catch (error) {
    return c.json(
      { ok: false, database: "unreachable", error: String(error) },
      503,
    );
  }
  return c.json({
    ok: true,
    database: "ready",
    latencyMs: Math.round(performance.now() - started),
  });
});

/** Live reads. Everything else is REST. */
app.route("/api/shapes", shapes);

/** The public contract, and the only API the web app uses. */
app.route("/api", api);

/**
 * In production the built frontend is served from the same origin (one
 * binary, one origin). Anything that is not an API path falls back to the SPA
 * shell so deep links into a run survive a reload.
 */
const webDist = process.env.WEB_DIST;
if (webDist) {
  app.use("/assets/*", serveStatic({ root: webDist }));
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch, idleTimeout: 90 };

// Close the pool and then exit. Closing alone leaves a live process that answers
// every request with a dead connection, which is worse than being down.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(0));
  });
}
