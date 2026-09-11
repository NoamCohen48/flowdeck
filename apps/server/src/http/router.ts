import { OpenAPIHono } from "@hono/zod-openapi";
import type { ActorEnv } from "./actor.ts";

/**
 * Every router is built here rather than with `new OpenAPIHono()` directly, so they
 * all share the validation hook.
 *
 * A sub-app mounted with `.route()` does not inherit its parent's `defaultHook`, so
 * a router constructed by hand silently falls back to a bare 400 with no field
 * information. The first consumer of this API is a migration script being debugged
 * against it; "the request did not validate" without saying which field is close to
 * useless to whoever is holding that script.
 */
export function createRouter() {
  return new OpenAPIHono<ActorEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "the request did not validate", details: result.error.issues },
          400,
        );
      }
    },
  });
}
