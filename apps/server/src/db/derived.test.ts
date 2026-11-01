/**
 * Worst-result-wins exists twice: as `VERDICT_RANK` in `@flowdeck/domain`, used by
 * the browser and the API, and as `verdict_rank()` in SQL, used wherever a run
 * summarises a test with several results.
 *
 * Two implementations of one rule is a drift waiting to happen, so the rule is that
 * they must agree — asserted here rather than assumed.
 */
import { describe, expect, test } from "bun:test";
import { sql as raw } from "drizzle-orm";
import { VERDICT_RANK, VERDICTS_WORST_FIRST, worstResult } from "@flowdeck/domain";
import type { Verdict } from "@flowdeck/domain";
import { query, sql } from "./client.ts";

const ALL: Verdict[] = ["pass", "fail", "minor", "skipped"];

describe("verdict_rank() in SQL matches VERDICT_RANK in TypeScript", () => {
  test("every verdict ranks identically in both", async () => {
    const rows = await query<{ v: string; rank: number }>(raw`
      select v, verdict_rank(v) as rank
      from unnest(array['pass','fail','minor','skipped']) as v
    `);

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.rank).toBe(VERDICT_RANK[row.v as Verdict]);
    }
  });

  test("the SQL ordering reproduces fail > skipped > minor > pass", async () => {
    const rows = await query<{ v: string }>(raw`
      select v from unnest(array['pass','fail','minor','skipped']) as v
      order by verdict_rank(v) desc
    `);

    expect(rows.map((r) => r.v)).toEqual([...VERDICTS_WORST_FIRST]);
  });

  test("for every pair, SQL max and worstResult() pick the same winner", async () => {
    for (const a of ALL) {
      for (const b of ALL) {
        const rows = await query<{ winner: string }>(raw`
          select v as winner
          from unnest(array[${a}::text, ${b}::text]) as v
          order by verdict_rank(v) desc
          limit 1
        `);

        expect(rows[0]!.winner).toBe(worstResult([a, b])!);
      }
    }
  });
});

describe("the coverage view", () => {
  test("never marks a covered test as needing attention", async () => {
    const rows = await query<{ bad: number }>(raw`
      select count(*)::int as bad from test_coverage
      where covered and needs_attention
    `);
    expect(rows[0]!.bad).toBe(0);
  });

  test("never flags an archived test — archiving stops it counting", async () => {
    const rows = await query<{ bad: number }>(raw`
      select count(*)::int as bad from test_coverage
      where archived and needs_attention
    `);
    expect(rows[0]!.bad).toBe(0);
  });

  test("covered is exactly 'some step in some flow in some template marks it'", async () => {
    // Recomputed from the base tables by a different route than the view takes,
    // so agreement means the view is right rather than merely self-consistent.
    const rows = await query<{ disagreements: number }>(raw`
      select count(*)::int as disagreements
      from test_coverage c
      where c.covered <> exists (
        select 1 from step_mark sm where sm.test_id = c.test_id
      )
    `);
    expect(rows[0]!.disagreements).toBe(0);
  });
});

process.on("beforeExit", () => void sql.end());
