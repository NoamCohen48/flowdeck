# Coverage and Reporting

---

## What coverage means

> A test is **covered** if at least one step, in at least one flow, in at least one template of its
> product, marks it.

Deliberately broad. It includes archived and never-run templates. Coverage answers *"is this test
reachable by some flow somewhere"*, not *"was it executed recently"* — the latter is a run question,
answered by run history.

## Coverage lives at the product level

Coverage warnings are computed across every template in the product, not per template.

A template that only covers a slice of the library is not deficient — that is the entire reason
several templates exist. One template targets one setup and can only reach the tests performable in
that setup. Warning per template would fire constantly and mean nothing.

The template page still reports its own scope ("covers 20 of 25") as information, and can list what
it misses, but it does not warn.

## The uncovered warning

A test marked by nothing anywhere is shown as an error state: red row, explicit label
("Not in any template"), and a permanent entry in the overview's "needs attention" panel.

The wording says what actually goes wrong rather than just flagging: *"In no template at all. It will
never be checked on a testing day."*

**Uncovered is allowed.** The system warns, it does not block. A test may be uncovered
because it is aspirational, because its feature is unreleased, or because nobody has got to it yet.
The requirement is awareness, not prohibition.

## Covered tests are listed with their templates

Each test in the library shows which templates cover it, as chips. This answers the two questions
authors actually ask: *"is this covered?"* and *"if I change this, what am I affecting?"*

The test detail view goes further and lists the exact steps that mark it, with device and flow
context, so an author can jump from an assertion to every place it is verified.

---

## Conflicting results within one run

Because a test may be marked in multiple flows, one run can produce several results for it — and
they can disagree. Flow 2 passes it, flow 4 fails it.

**Worst result wins on the dashboard.** Precedence:

```
fail  >  skipped  >  minor  >  pass
```

A fail anywhere means the test failed that day. Everything else would let a passing path bury a
real bug.

Skipped ranks above minor and pass because a test reported as invalid should not appear green;
its result is not trustworthy either way.

The individual results are all retained and visible on the test's detail view — only the summary
number collapses them.

---

## Run reporting

Per run:

- Counts by verdict: passed, failed, minor, skipped.
- **Not reached** — tests in the template's scope with no result at all.
- Per-flow progress and who ran it.
- Every failure with its note, screenshot, and whether it blocked.
- Every skipped test with its note — effectively the to-do list for maintaining the suite.

Per test, over time: which versions were executed on which days and with what outcome. Because
results pin a version ID, a result from March remains readable against March's wording even after
six edits.

## Dashboards

**Product overview** — library size, covered vs uncovered, template count, today's run progress,
and a "needs attention" list combining uncovered tests, today's failures, and today's skipped tests.

**Test library** — every test with coverage chips and today's verdict, filterable to uncovered only.

**Testing day** — verdict counts including not-reached, per-flow progress and ownership.
