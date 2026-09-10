/**
 * Flowdeck server. One origin: the REST API, the Electric shape proxy, the
 * attachment store, and (in production) the built frontend.
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { db, sql } from "./db/client.ts";
import { sql as raw } from "drizzle-orm";
import { withActor, type ActorEnv } from "./http/actor.ts";
import { shapes } from "./http/shapes.ts";

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

/** Live reads (D33). Everything else is REST. */
app.route("/api/shapes", shapes);

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch, idleTimeout: 90 };

process.on("SIGTERM", () => void sql.end());
