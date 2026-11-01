/**
 * The few routes the CLI uses, typed by hand: the suite routes, products, runs
 * and the issue feed. Every failure becomes a `CliError` with an exit code, so a
 * script or an agent can tell "the suite has errors" from "the server moved on"
 * from "the server is not there".
 */
import type { Suite, SuiteProblem } from "@flowdeck/domain";

export const EXIT = { ok: 0, invalid: 1, usage: 2, stale: 3, server: 4 } as const;

export class CliError extends Error {
  constructor(message: string, readonly code: number = EXIT.server, readonly details?: unknown) {
    super(message);
  }
}

export interface Product { id: string; slug: string; name: string; description: string }
export interface SuiteDoc { revision: string; suite: Suite }
export interface Plan { revision: string; summary: string[]; changes: unknown[]; problems: SuiteProblem[] }
export interface Pushed extends Plan { previousRevision: string }
export interface RunSummary { id: string; templateId: string; templateName: string; date: string; closedAt: string | null; total: number; counts: Record<"pass" | "fail" | "minor" | "skipped", number>; notReached: number }
export interface IssueFeed {
  run: { id: string; date: string; product: string; template: string; templateKey: string | null; closedAt: string | null };
  issues: {
    type: "failure" | "minor" | "invalid_test" | "pass";
    test: { key: string | null; title: string; expected: string; version: number };
    context: { flowKey: string | null; flow: string; stepNumber: number; stepText: string; device: string };
    note: string | null;
    blocking: boolean;
    recordedBy: string;
    attachments: string[];
  }[];
  stepProblems: { context: IssueFeed["issues"][number]["context"]; note: string; workaround: string | null; blocking: boolean; recordedBy: string }[];
}

export class Client {
  constructor(readonly url: string, readonly actor: string | undefined) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/+$/, "")}/api${path}`, {
        method,
        headers: { "content-type": "application/json", ...(this.actor ? { "x-flowdeck-actor": this.actor } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CliError(`cannot reach Flowdeck at ${this.url}: ${(e as Error).message}`, EXIT.server);
    }
    const data = (await res.json().catch(() => null)) as ({ error?: string; details?: unknown; revision?: string } & T) | null;
    if (res.ok) return data as T;
    const message = data?.error ?? `${res.status} ${res.statusText}`;
    if (res.status === 401) throw new CliError(`writes are attributed to a name: flowdeck login --as "<your name>", or set FLOWDECK_ACTOR`, EXIT.usage);
    if (res.status === 409) throw new CliError(message, EXIT.stale, data);
    if (res.status === 400) throw new CliError(message, EXIT.invalid, data?.details);
    if (res.status === 404) throw new CliError(message, EXIT.usage);
    throw new CliError(message, EXIT.server, data);
  }

  products() { return this.call<Product[]>("GET", "/products"); }
  product(ref: string) { return this.call<Product>("GET", `/products/${encodeURIComponent(ref)}`); }
  createProduct(name: string, slug?: string, description?: string) {
    return this.call<Product>("POST", "/products", { name, ...(slug ? { slug } : {}), ...(description ? { description } : {}) });
  }
  suite(ref: string) { return this.call<SuiteDoc>("GET", `/products/${encodeURIComponent(ref)}/suite`); }
  plan(ref: string, suite: Suite) { return this.call<Plan>("POST", `/products/${encodeURIComponent(ref)}/suite/plan`, suite); }
  push(ref: string, suite: Suite, baseRevision: string, force: boolean) {
    return this.call<Pushed>("PUT", `/products/${encodeURIComponent(ref)}/suite`, { suite, baseRevision, force });
  }
  runs(productId: string) { return this.call<RunSummary[]>("GET", `/products/${productId}/runs`); }
  issues(runId: string) { return this.call<IssueFeed>("GET", `/runs/${runId}/issues`); }
}
