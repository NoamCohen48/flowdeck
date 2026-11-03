/**
 * Makes the stored suite the desired one, inside the caller's transaction.
 * `planSuite` says what will change; this does it, by the same rules: match by
 * key, archive what is left out, new version for an edited test, and steps
 * matched by content so a step that survives keeps its id.
 */
import { eq, inArray, sql as raw } from "drizzle-orm";
import type { Suite, SuiteStep } from "@flowdeck/domain";
import type { db } from "../db/client.ts";
import { flow, product, step, stepMark, template, test, testVersion } from "../db/schema.ts";
import { matchSteps, metadataOf, sameJson, stepDiffers, type Stored, type StoredStep } from "@flowdeck/domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const norm = (s: string | null | undefined) => (s ?? "").trim();

function stepRow(s: SuiteStep, position: number) {
  return {
    position,
    kind: s.kind === "check" ? ("assertion" as const) : ("action" as const),
    text: s.text.trim(),
    deviceLabel: s.device.trim(),
    expectedResult: s.kind === "check" && norm(s.expect) ? norm(s.expect) : null,
    postState: norm(s.after) || null,
  };
}

export async function applySuite(tx: Tx, productId: string, stored: Stored, desired: Suite, actor: string) {
  /* Product. */
  const graph = desired.graph ?? null;
  if (stored.product.name !== desired.product.name || stored.product.description !== (desired.product.description ?? "") || JSON.stringify(stored.product.graph ?? null) !== JSON.stringify(graph)) {
    await tx.update(product).set({ name: desired.product.name, description: desired.product.description ?? "", graph }).where(eq(product.id, productId));
  }

  /* Tests. */
  const testId = new Map(stored.tests.map((t) => [t.key, t.id]));
  const storedTests = new Map(stored.tests.map((t) => [t.key, t]));
  const desiredTestKeys = new Set(desired.tests.map((t) => t.key));
  for (const t of desired.tests) {
    const s = storedTests.get(t.key);
    const metadata = metadataOf(t);
    if (!s) {
      const [row] = await tx.insert(test).values({ productId, key: t.key, archived: t.archived ?? false }).returning();
      const [v] = await tx
        .insert(testVersion)
        .values({ testId: row!.id, version: 1, title: t.title.trim(), expectedResult: t.expect.trim(), metadata, createdBy: actor })
        .returning();
      await tx.update(test).set({ currentVersionId: v!.id }).where(eq(test.id, row!.id));
      testId.set(t.key, row!.id);
      continue;
    }
    const edited = norm(s.title) !== norm(t.title) || norm(s.expect) !== norm(t.expect) || !sameJson(s.metadata, metadata);
    if (edited) {
      // A new version; the old one stays exactly as it was.
      const [{ version }] = (await tx.execute(
        raw`select max(version)::int as version from test_version where test_id = ${s.id}`,
      )) as unknown as [{ version: number }];
      const [v] = await tx
        .insert(testVersion)
        .values({ testId: s.id, version: version + 1, title: t.title.trim(), expectedResult: t.expect.trim(), metadata, createdBy: actor })
        .returning();
      await tx.update(test).set({ currentVersionId: v!.id }).where(eq(test.id, s.id));
    }
    if (s.archived !== (t.archived ?? false)) await tx.update(test).set({ archived: t.archived ?? false }).where(eq(test.id, s.id));
  }
  const toArchive = stored.tests.filter((s) => !s.archived && !desiredTestKeys.has(s.key)).map((s) => s.id);
  if (toArchive.length) await tx.update(test).set({ archived: true }).where(inArray(test.id, toArchive));

  const idOf = (key: string) => testId.get(key);

  /* Templates, flows, steps, marks. */
  const storedTemplates = new Map(stored.templates.map((t) => [t.key, t]));
  const desiredTemplateKeys = new Set(desired.templates.map((t) => t.key));
  for (const t of desired.templates) {
    const status = t.archived ? ("archived" as const) : ("active" as const);
    const s = storedTemplates.get(t.key);
    let templateId: string;
    if (!s) {
      const [row] = await tx.insert(template).values({ productId, key: t.key, name: t.name, description: t.description ?? "", status }).returning();
      templateId = row!.id;
    } else {
      templateId = s.id;
      if (s.name !== t.name || s.description !== (t.description ?? "") || s.archived !== (t.archived ?? false)) {
        await tx.update(template).set({ name: t.name, description: t.description ?? "", status }).where(eq(template.id, templateId));
      }
    }

    const storedFlows = new Map((s?.flows ?? []).map((f) => [f.key, f]));
    const desiredFlowKeys = new Set(t.flows.map((f) => f.key));
    for (const [position, f] of t.flows.entries()) {
      const fields = {
        name: f.name,
        precondition: f.precondition ?? "",
        estimatedMinutes: f.estimateMinutes ?? null,
        archived: f.archived ?? false,
        position,
      };
      const sf = storedFlows.get(f.key);
      let flowId: string;
      if (!sf) {
        const [row] = await tx.insert(flow).values({ templateId, key: f.key, ...fields }).returning();
        flowId = row!.id;
      } else {
        flowId = sf.id;
        const was = (s?.flows ?? []).indexOf(sf);
        if (sf.name !== fields.name || sf.precondition !== fields.precondition || sf.estimateMinutes !== fields.estimatedMinutes || sf.archived !== fields.archived || was !== position) {
          await tx.update(flow).set(fields).where(eq(flow.id, flowId));
        }
      }
      await applySteps(tx, flowId, sf?.steps ?? [], f.steps, idOf);
    }
    // Flows left out are archived and go to the end, keeping positions dense.
    const leftOut = (s?.flows ?? []).filter((sf) => !desiredFlowKeys.has(sf.key));
    for (const [i, sf] of leftOut.entries()) {
      await tx.update(flow).set({ archived: true, position: t.flows.length + i }).where(eq(flow.id, sf.id));
    }
  }
  const templatesToArchive = stored.templates.filter((s) => !s.archived && !desiredTemplateKeys.has(s.key)).map((s) => s.id);
  if (templatesToArchive.length) await tx.update(template).set({ status: "archived" }).where(inArray(template.id, templatesToArchive));
}

async function applySteps(tx: Tx, flowId: string, stored: readonly StoredStep[], desired: readonly SuiteStep[], idOf: (key: string) => string | undefined) {
  const match = matchSteps(stored, desired);
  const byId = new Map(stored.map((s) => [s.id, s]));

  // Removing a step removes its marks (cascade). Results recorded against it
  // live on in their run's snapshot, which never pointed at this row.
  if (match.removed.length) await tx.delete(step).where(inArray(step.id, [...match.removed]));

  for (const [position, d] of desired.entries()) {
    const id = match.ids[position] ?? null;
    const want = [...new Set((d.verifies ?? []).map((k) => idOf(k)!))];
    if (id === null) {
      const [row] = await tx.insert(step).values({ flowId, ...stepRow(d, position) }).returning();
      if (want.length) await tx.insert(stepMark).values(want.map((testId) => ({ stepId: row!.id, testId })));
      continue;
    }
    const s = byId.get(id)!;
    const was = stored.indexOf(s);
    if (stepDiffers(s, d, idOf) || was !== position) {
      await tx.update(step).set({ ...stepRow(d, position), updatedAt: new Date() }).where(eq(step.id, id));
    }
    const have = new Set(s.verifies);
    if (want.length !== have.size || want.some((t) => !have.has(t))) {
      await tx.delete(stepMark).where(eq(stepMark.stepId, id));
      if (want.length) await tx.insert(stepMark).values(want.map((testId) => ({ stepId: id, testId })));
    }
  }
}
