/** Prints the OpenAPI document. `packages/api-client` is generated from this. */
import { api } from "./http/api.ts";
const doc = api.getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "Flowdeck", version: "0.1.0" },
});
console.log(JSON.stringify(doc, null, 2));
