import { createApi } from "@flowdeck/api-client";
import type { components } from "@flowdeck/api-client";

/** One origin: the Vite dev proxy and Caddy both put the API under /api. */
export const api = createApi("/api");

export type Schemas = components["schemas"];
export type Product = Schemas["Product"];
export type Test = Schemas["Test"];
export type Run = Schemas["Run"];
export type RunSummary = Schemas["RunSummary"];
export type FlowRun = Schemas["FlowRun"];
export type TestResult = Schemas["TestResult"];
export type TemplateSnapshot = Schemas["TemplateSnapshot"];
export type SnapshotFlow = TemplateSnapshot["flows"][number];
export type SnapshotStep = SnapshotFlow["steps"][number];
export type TemplateSummary = Schemas["TemplateSummary"];

/** Throws on a non-2xx so callers can `await` and use the data directly. */
export async function unwrap<T>(
  p: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || data === undefined) {
    const message =
      typeof error === "object" && error && "error" in error
        ? String((error as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, error);
  }
  return data;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}
