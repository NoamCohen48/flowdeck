/**
 * Seeds a development database.
 *
 * Two products, because multi-product is day one (D23) and product switching is a
 * real surface rather than a modelled-but-unused one. The Relay data is the demo's,
 * translated into the split the docs describe — its assertions become tests, its
 * procedures become flow steps, and the join between them becomes step marks.
 *
 * Plus, behind `--volume`, a synthetic product at the scale the UI actually has to
 * survive: 300 tests and fifty-step flows. Verifying the editor sidebar and the
 * dashboards against eight demo flows proves nothing.
 *
 *   bun src/db/seed.ts [--volume] [--reset]
 */
import { sql as raw } from "drizzle-orm";
import { db, sql } from "./client.ts";
import {
  actor,
  flow,
  flowRun,
  product,
  run,
  step,
  stepMark,
  template,
  test,
  testResult,
  testVersion,
} from "./schema.ts";
import seedData from "./seed-data.json" with { type: "json" };
import type { StepKind, TemplateStatus, Verdict } from "@flowdeck/domain";

const args = new Set(process.argv.slice(2));
const WITH_VOLUME = args.has("--volume");
const RESET = args.has("--reset") || WITH_VOLUME;

const TESTERS = ["Noa", "Yuval", "Ori", "Dana", "Amit", "Roni", "Tomer"];

/** The demo's verdict keys are abbreviated; the model's are not. */
const VERDICT: Record<string, Verdict> = {
  pass: "pass",
  fail: "fail",
  minor: "minor",
  skip: "skipped",
};

if (RESET) {
  // Order does not matter: every dependent row cascades from product, and runs
  // cascade from their template.
  await db.execute(
    raw`truncate table product, actor, run restart identity cascade`,
  );
  console.log("existing data cleared");
}

for (const name of TESTERS) {
  await db.insert(actor).values({ name }).onConflictDoNothing();
}

for (const p of seedData.products) {
  const [row] = await db
    .insert(product)
    .values({ name: p.name, description: p.description })
    .returning();
  const productId = row!.id;

  /* Tests. Each carries a version history, because a test is immutable at the
     version level and stable at the identity level (D6) — and the version view
     is not worth much against a library where everything is at v1. */
  const testIdByKey = new Map<string, string>();
  const currentVersionIdByKey = new Map<string, string>();

  for (const t of p.tests) {
    const [testRow] = await db.insert(test).values({ productId }).returning();
    const testId = testRow!.id;

    let currentVersionId = "";
    for (let v = 1; v <= t.version; v++) {
      const isCurrent = v === t.version;
      const [versionRow] = await db
        .insert(testVersion)
        .values({
          testId,
          version: v,
          title: t.title,
          expectedResult: isCurrent
            ? t.expectedResult
            : `Draft wording, revised in v${v + 1}. — ${t.expectedResult}`,
          metadata: t.metadata,
          createdBy: TESTERS[(v + t.title.length) % TESTERS.length]!,
        })
        .returning();
      if (isCurrent) currentVersionId = versionRow!.id;
    }

    await db
      .update(test)
      .set({ currentVersionId })
      .where(raw`${test.id} = ${testId}`);

    testIdByKey.set(t.key, testId);
    currentVersionIdByKey.set(t.key, currentVersionId);
  }

  /* Templates, flows, steps, marks. */
  const flowIdByKey = new Map<string, string>();
  const templateIdByKey = new Map<string, string>();
  /** test key -> the steps that mark it, so the seeded run can attach results. */
  const stepsByTestKey = new Map<string, { stepId: string; flowKey: string }[]>();

  for (const tpl of p.templates) {
    const [templateRow] = await db
      .insert(template)
      .values({
        productId,
        name: tpl.name,
        description: tpl.description,
        status: tpl.status as TemplateStatus,
      })
      .returning();
    templateIdByKey.set(tpl.key, templateRow!.id);

    for (const [flowIndex, f] of tpl.flows.entries()) {
      const [flowRow] = await db
        .insert(flow)
        .values({
          templateId: templateRow!.id,
          name: f.name,
          precondition: f.precondition,
          estimatedMinutes: f.estimatedMinutes ?? null,
          position: flowIndex,
        })
        .returning();
      flowIdByKey.set(f.key, flowRow!.id);

      for (const [stepIndex, s] of f.steps.entries()) {
        const [stepRow] = await db
          .insert(step)
          .values({
            flowId: flowRow!.id,
            position: stepIndex,
            kind: s.kind as StepKind,
            text: s.text,
            expectedResult: s.expectedResult,
            deviceLabel: s.deviceLabel,
          })
          .returning();

        for (const testKey of s.marks) {
          const testId = testIdByKey.get(testKey);
          if (!testId) throw new Error(`step marks unknown test ${testKey}`);
          await db.insert(stepMark).values({ stepId: stepRow!.id, testId });
          const list = stepsByTestKey.get(testKey) ?? [];
          list.push({ stepId: stepRow!.id, flowKey: f.key });
          stepsByTestKey.set(testKey, list);
        }
      }
    }
  }

  /* A partly-executed testing day, so the runner and the board have something real
     to show: one flow finished, two in progress, one untouched, and a spread of all
     four verdicts including a non-blocking failure and a skipped stale test. */
  if ("run" in p && p.run) {
    const r = p.run;
    const templateId = templateIdByKey.get(r.templateKey)!;
    const snapshot = await snapshotTemplate(templateId);

    const [runRow] = await db
      .insert(run)
      .values({ templateId, templateSnapshot: snapshot, startedBy: r.startedBy })
      .returning();

    const flowRunIdByFlowKey = new Map<string, string>();
    for (const [flowKey, flowId] of flowIdByKey) {
      const claimedBy = (r.claims as Record<string, string>)[flowKey] ?? null;
      const isFinished = r.finished.includes(flowKey);
      // Only flows belonging to this run's template take part.
      if (!snapshot.flows.some((f: { id: string }) => f.id === flowId)) continue;

      const [flowRunRow] = await db
        .insert(flowRun)
        .values({
          runId: runRow!.id,
          flowId,
          claimedBy,
          state: isFinished ? "finished" : claimedBy ? "claimed" : "open",
          finishedAt: isFinished ? new Date() : null,
        })
        .returning();
      flowRunIdByFlowKey.set(flowKey, flowRunRow!.id);
    }

    for (const [testKey, result] of Object.entries(
      r.results as Record<string, { v: string; note?: string; blocking?: boolean }>,
    )) {
      const marks = stepsByTestKey.get(testKey);
      if (!marks?.length) continue;
      const mark = marks[0]!;
      const flowRunId = flowRunIdByFlowKey.get(mark.flowKey);
      if (!flowRunId) continue;

      const verdict = VERDICT[result.v]!;
      await db.insert(testResult).values({
        flowRunId,
        stepId: mark.stepId,
        testId: testIdByKey.get(testKey)!,
        testVersionId: currentVersionIdByKey.get(testKey)!,
        verdict,
        note: result.note ?? null,
        blocking: result.blocking ?? false,
        recordedBy: (r.claims as Record<string, string>)[mark.flowKey] ?? r.startedBy,
        idempotencyKey: `seed:${runRow!.id}:${testKey}`,
      });
    }
    console.log(`  seeded a testing day for ${p.name}`);
  }

  console.log(
    `${p.name}: ${p.tests.length} tests, ${p.templates.length} templates, ` +
      `${p.templates.flatMap((t) => t.flows).length} flows`,
  );
}

if (WITH_VOLUME) await seedVolumeProduct();

await sql.end();

/* ── helpers ─────────────────────────────────────────────────────────── */

/**
 * The frozen copy a run executes against (D21). Taken at start, never re-read from
 * the live template, so an edit during the day cannot reshuffle a tester's checklist.
 */
async function snapshotTemplate(templateId: string) {
  const rows = await db.execute(raw`
    select
      tpl.id, tpl.name, tpl.description, tpl.status,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', f.id, 'name', f.name, 'precondition', f.precondition,
          'estimatedMinutes', f.estimated_minutes, 'position', f.position,
          'steps', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', s.id, 'position', s.position, 'kind', s.kind, 'text', s.text,
              'expectedResult', s.expected_result, 'deviceLabel', s.device_label,
              'marks', (select coalesce(jsonb_agg(sm.test_id), '[]'::jsonb)
                        from step_mark sm where sm.step_id = s.id)
            ) order by s.position), '[]'::jsonb)
            from step s where s.flow_id = f.id
          )
        ) order by f.position
      ) filter (where f.id is not null), '[]'::jsonb) as flows
    from template tpl
    left join flow f on f.template_id = tpl.id
    where tpl.id = ${templateId}
    group by tpl.id
  `);
  return rows[0] as unknown as { id: string; flows: { id: string }[] };
}

/**
 * Scale, not realism. `07-open-items.md` specifies a summary sidebar precisely
 * because "a flow is hard to navigate in a single scrolling column when the flow is
 * fifty steps long" — so the seed had better contain fifty-step flows.
 */
async function seedVolumeProduct() {
  const [row] = await db
    .insert(product)
    .values({
      name: "Atlas (volume)",
      description:
        "Synthetic data at the scale the interface has to survive. Not a real product.",
    })
    .returning();
  const productId = row!.id;

  const testIds: string[] = [];
  for (let i = 1; i <= 300; i++) {
    const [t] = await db.insert(test).values({ productId }).returning();
    const [v] = await db
      .insert(testVersion)
      .values({
        testId: t!.id,
        version: 1,
        title: `Synthetic assertion ${i} holds after a state change`,
        expectedResult: `Condition ${i} is observably true and no error is surfaced.`,
        metadata: { tags: ["synthetic", `group-${Math.ceil(i / 25)}`] },
        createdBy: TESTERS[i % TESTERS.length]!,
      })
      .returning();
    await db
      .update(test)
      .set({ currentVersionId: v!.id })
      .where(raw`${test.id} = ${t!.id}`);
    testIds.push(t!.id);
  }

  const [tpl] = await db
    .insert(template)
    .values({
      productId,
      name: "Full synthetic sweep",
      description: "Eight flows, up to fifty steps each.",
      status: "active",
    })
    .returning();

  const devices = ["Pixel 8", "iPhone 13", "Chrome on laptop", "Second laptop", "Tablet"];
  let cursor = 0;
  for (let f = 0; f < 8; f++) {
    const stepCount = 30 + ((f * 7) % 21); // 30–50
    const [flowRow] = await db
      .insert(flow)
      .values({
        templateId: tpl!.id,
        name: `Synthetic flow ${f + 1}`,
        precondition: "A freshly reset synthetic environment.",
        estimatedMinutes: 20 + f * 5,
        position: f,
      })
      .returning();

    for (let s = 0; s < stepCount; s++) {
      const isCheck = s % 3 === 2;
      const [stepRow] = await db
        .insert(step)
        .values({
          flowId: flowRow!.id,
          position: s,
          kind: isCheck ? "assertion" : "action",
          text: isCheck
            ? `Observe the result of step ${s} on the current screen.`
            : `Perform synthetic action ${s + 1}.`,
          expectedResult: isCheck ? `The state advances to ${s + 1} without error.` : null,
          // Devices are introduced gradually, so hand-off banners appear mid-flow.
          deviceLabel: devices[Math.min(Math.floor(s / 12), devices.length - 1)]!,
        })
        .returning();

      if (isCheck && cursor < testIds.length) {
        // Most checks mark one test; every fifth marks three, since a single check
        // confirming several assertions is normal (D12).
        const count = s % 5 === 2 ? 3 : 1;
        for (let k = 0; k < count && cursor < testIds.length; k++) {
          await db.insert(stepMark).values({
            stepId: stepRow!.id,
            testId: testIds[cursor++]!,
          });
        }
      }
    }
  }

  console.log("Atlas (volume): 300 tests, 8 flows of 30–50 steps");
}
