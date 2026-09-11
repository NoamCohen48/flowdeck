/**
 * Prints the OpenAPI document. `packages/api-client` is generated from this, and
 * so is `docs/openapi.json` — the same config the server serves at
 * `/api/openapi.json`, so the three never disagree.
 */
import { api, openApiConfig } from "./http/api.ts";
const doc = api.getOpenAPIDocument(openApiConfig);
console.log(JSON.stringify(doc, null, 2));
