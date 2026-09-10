-- Derived state, defined once in SQL so it cannot drift from the copy in
-- @flowdeck/domain. `derived.test.ts` runs both against the same inputs.

-- Worst result wins (D19): fail > skipped > minor > pass.
-- Mirrors VERDICT_RANK in packages/domain/src/verdict.ts.
create or replace function verdict_rank(v text) returns integer
  language sql immutable parallel safe as $$
  select case v
    when 'fail'    then 3
    when 'skipped' then 2
    when 'minor'   then 1
    when 'pass'    then 0
  end
$$;

-- Coverage (.docs/04-coverage-and-reporting.md).
--
--   A test is covered if at least one step, in at least one flow, in at least
--   one template of its product, marks it.
--
-- Deliberately broad: archived and never-run templates count (D3), because the
-- question is "is this reachable by some flow somewhere", not "was it executed
-- recently". Computed rather than stored, so it cannot go stale.
create or replace view test_coverage as
select
  t.id                                             as test_id,
  t.product_id,
  t.archived,
  coalesce(m.template_ids, '{}')                   as template_ids,
  coalesce(array_length(m.template_ids, 1), 0) > 0 as covered,
  -- The red row and the "needs attention" entry. An archived test stops
  -- counting toward coverage and stops warning (D7) — flagging it would be noise.
  (coalesce(array_length(m.template_ids, 1), 0) = 0 and not t.archived)
                                                   as needs_attention
from test t
left join lateral (
  select array_agg(distinct f.template_id) as template_ids
  from step_mark sm
  join step s on s.id = sm.step_id
  join flow f on f.id = s.flow_id
  where sm.test_id = t.id
) m on true;

-- Electric follows Postgres logical replication. REPLICA IDENTITY FULL makes
-- updates and deletes carry their old row, which Electric needs to keep a
-- subscriber's copy correct rather than merely eventually correct.
alter table test_result replica identity full;
alter table flow_run    replica identity full;
alter table presence    replica identity full;
alter table step        replica identity full;
alter table step_mark   replica identity full;
