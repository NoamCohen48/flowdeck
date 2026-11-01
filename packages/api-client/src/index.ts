/**
 * The typed client for Flowdeck's REST API, generated from the OpenAPI document
 * the server derives from its own Zod schemas. The web app is the heaviest
 * consumer of the same API external adapters use, so a contract break is noticed
 * here first.
 */
import createClient from "openapi-fetch";
import type { paths } from "./types.ts";

export type { paths, components } from "./types.ts";

export function createApi(baseUrl = "") {
  return createClient<paths>({ baseUrl, credentials: "same-origin" });
}

export type Api = ReturnType<typeof createApi>;
