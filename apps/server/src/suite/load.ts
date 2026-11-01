/**
 * A product's suite as stored, in two forms: `Stored` (with ids, what `planSuite`
 * diffs against) and `Suite` (with keys, what `GET /products/{ref}/suite` returns
 * and the CLI writes to files). Plus the revision, a hash of the second form, so a
 * push can say "this is what I started from" and be refused when someone else
 * has changed the suite since.
 */
import { createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { Suite, SuiteFlow, SuiteStep, SuiteTemplate, SuiteTest } from "@flowdeck/domain";
import { db } from "../db/client.ts";
import { flow, product, step, stepMark, template, test, testVersion } from "../db/schema.ts";
import type { Stored, StoredTemplate, StoredTest } from "@flowdeck/domain";

type Conn = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export async function loadStored(conn: Conn, productId: string): Promise<Stored | undefined> {
  const [p] = await conn.select().from(product).where(eq(product.id, productId));
  if (!p) return undefined;

  const tests = await conn
    .select({ id: test.id, key: test.key, archived: test.archived, title: testVersion.title, expect: testVersion.expectedResult, metadata: testVersion.metadata })
    .from(test)
    .innerJoin(testVersion, eq(testVersion.id, test.currentVersionId))
    .where(eq(test.productId, productId))
    .orderBy(asc(test.key));

  const templates = await conn.select().from(template).where(eq(template.productId, productId)).orderBy(asc(template.key));
  const flows = templates.length
    ? await conn.select().from(flow).where(inArray(flow.templateId, templates.map((t) => t.id))).orderBy(asc(flow.position), asc(flow.createdAt))
    : [];
  const steps = flows.length
    ? await conn.select().from(step).where(inArray(step.flowId, flows.map((f) => f.id))).orderBy(asc(step.position))
    : [];
  const marks = steps.length
    ? await conn.select().from(stepMark).where(inArray(stepMark.stepId, steps.map((s) => s.id)))
    : [];

  const marksOf = new Map<string, string[]>();
  for (const m of marks) marksOf.set(m.stepId, [...(marksOf.get(m.stepId) ?? []), m.testId]);

  return {
    product: { name: p.name, description: p.description },
    tests: tests.map((t): StoredTest => ({
      id: t.id, key: t.key, title: t.title, expect: t.expect, archived: t.archived,
      metadata: (t.metadata ?? {}) as Record<string, unknown>,
    })),
    templates: templates.map((t): StoredTemplate => ({
      id: t.id, key: t.key, name: t.name, description: t.description, archived: t.status === "archived",
      flows: flows.filter((f) => f.templateId === t.id).map((f) => ({
        id: f.id, key: f.key, name: f.name, precondition: f.precondition, estimateMinutes: f.estimatedMinutes, archived: f.archived,
        steps: steps.filter((s) => s.flowId === f.id).map((s) => ({
          id: s.id,
          kind: s.kind === "assertion" ? "check" : "action",
          text: s.text,
          device: s.deviceLabel,
          expect: s.expectedResult,
          after: s.postState,
          verifies: marksOf.get(s.id) ?? [],
        })),
      })),
    })),
  };
}

/**
 * The document form. Tests come sorted by key and templates by key, because
 * that is the order files list in; flows and steps keep their order, which
 * means something. Empty and default fields are left out so the files stay
 * short. An archived test is included only while something still verifies it —
 * otherwise it is history, not part of the suite anyone edits.
 */
export function toSuite(stored: Stored): Suite {
  const keyOf = new Map(stored.tests.map((t) => [t.id, t.key]));
  const verified = new Set(stored.templates.flatMap((t) => t.flows.flatMap((f) => f.steps.flatMap((s) => s.verifies))));

  const tests = stored.tests
    .filter((t) => !t.archived || verified.has(t.id))
    .map((t): SuiteTest => {
      const { tags, ...rest } = t.metadata as { tags?: unknown };
      const tagList = Array.isArray(tags) && tags.every((x) => typeof x === "string") ? (tags as string[]) : undefined;
      const metadata = tagList || tags === undefined ? rest : { ...rest, tags };
      return {
        key: t.key,
        title: t.title,
        expect: t.expect,
        ...(tagList?.length ? { tags: tagList } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
        ...(t.archived ? { archived: true } : {}),
      };
    });

  const templates = stored.templates.map((t): SuiteTemplate => ({
    key: t.key,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    ...(t.archived ? { archived: true } : {}),
    flows: t.flows.map((f): SuiteFlow => ({
      key: f.key,
      name: f.name,
      ...(f.precondition ? { precondition: f.precondition } : {}),
      ...(f.estimateMinutes != null ? { estimateMinutes: f.estimateMinutes } : {}),
      ...(f.archived ? { archived: true } : {}),
      steps: f.steps.map((s): SuiteStep => ({
        kind: s.kind,
        text: s.text,
        device: s.device,
        ...(s.kind === "check" && s.expect ? { expect: s.expect } : {}),
        ...(s.after ? { after: s.after } : {}),
        ...(s.verifies.length ? { verifies: s.verifies.map((id) => keyOf.get(id)!).sort() } : {}),
      })),
    })),
  }));

  return {
    product: { name: stored.product.name, ...(stored.product.description ? { description: stored.product.description } : {}) },
    tests,
    templates,
  };
}

/** Stable JSON: object keys sorted, so the same suite always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** What a pull records and a push names as its base. Short, because people read it. */
export function revisionOf(stored: Stored): string {
  return createHash("sha256").update(canonical(toSuite(stored))).digest("hex").slice(0, 12);
}
