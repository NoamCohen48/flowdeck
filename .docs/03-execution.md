# Execution — the testing day

*The screen seven people stare at for four hours. The most important surface in the product.*

---

## Starting a day

A coordinator picks a template and starts a run. The run takes a frozen snapshot of the template at
that moment. Template edits made during the day apply to the *next* run, never to this one.

## Claiming flows

The testing day page lists every flow with its precondition, step count, device requirements,
optional time estimate, and current state.

- A tester claims a flow and works it end to end.
- **A claim is advisory, not a lock.** It marks the flow as taken so nobody duplicates work by
  accident — it does not reserve it.
- **An already-claimed flow can still be claimed by someone else.** The UI shows who holds it and
  their progress, and asks for confirmation before proceeding. The original tester is never kicked
  off; both run independently and both sets of results are kept.

  This covers the common case where somebody claims a flow and walks away without pressing abandon —
  the flow must not be locked away by an absent tester. It also enables deliberate double-running of
  important flows, which is a good thing: two independent passes over core logic give two
  validations. Worst-result-wins handles any disagreement.

- One *person* per FlowRun, though. A single execution is a continuous stateful session on one set of
  hardware and cannot be split between two people mid-way.
- Everyone does not run everything by default. Blanket redundancy across seven people would waste
  the day; targeted redundancy on important flows is the tester's choice.

## Resuming across days

A run stays open indefinitely. A full sweep need not finish in one sitting.

- **Unclaimed flows** can be taken at any time, on any day the run is open.
- **A partially-executed flow does not carry over.** When a tester stops mid-flow and comes back
  later, or someone else picks it up, it restarts from step 1 and the abandoned results are
  discarded.

The reason is state, not policy. A flow's later steps depend on state its earlier steps built, and
that state does not survive overnight — the phone reboots, the session expires, someone else uses
the test account. Continuing from step 9 the next morning silently assumes a product state nobody
verified still exists, and produces a passed result that means nothing.

## Guardrails instead of roles

There are no roles. Everyone can edit tests, edit templates, start runs and record results. For a
seven-person team, a permission system would block work whenever the one person with rights is
away, and every change is already attributed in the audit trail.

Two destructive operations get a confirmation that states the consequence:

- **Archiving a test** — "T-42 is marked by 3 flows across 2 templates. Archiving removes it from
  coverage."
- **Starting a run** — names the template and warns if a run is already open for it.

## Working through a flow

The tester sees one long list. No back-and-forth, no jumping between tables — the whole point.

Each step shows:

- **Which device**, as a coloured chip and a coloured left edge on the step.
- **Action or check**, as a distinct marker.
- **The instruction.**
- **The expected result**, for checks.
- **The tests this step verifies**, each with its own verdict controls.

A running device bar sits at the top showing every device currently in play, growing as the flow
introduces more.

### Device hand-offs

When a flow reaches a step needing a device not yet in use, a full-width banner in that device's
colour announces it: *"Pick up iPhone 13 — iOS, same account. Everything in this colour from here
on happens on the iPhone."*

This is the loudest element on the screen, deliberately. Picking up the wrong device is the most
common and most confusing failure mode in the current Confluence suite, and the design spends its
attention budget here.

---

## Recording results

Verdicts are recorded **per test**. A step marking three tests presents three rows.

| Verdict | Meaning | Note required | Counts as verified |
|---|---|---|---|
| **Pass** | It behaved as the test says | No | Yes |
| **Fail** | It did not | **Yes** + screenshot + blocking choice | No |
| **Minor** | Something was off, but not breaking | Optional | **Yes** |
| **Skipped** | The *test* is wrong, not the product | **Yes** | **No — separate category** |

Pass and fail are definitive: it went well, or it did not.

**Minor** is for the case where behaviour deviates but nothing is broken — a slight delay, a cosmetic
oddity. It counts as covered and verified for the day. The test was checked, and the answer was
"fine, with a caveat".

**Skipped** is not a verdict on the product at all. It means the test itself is stale — the UI moved,
the wording no longer matches, the feature was redesigned. It is a distinct category, not a shade of
pass or fail, and it does not count as verified. It is the channel through which testers report
problems with the suite, since runs are otherwise read-only.

### Shortcuts

- **Pass all** on a step marks every attached test as passed in one click. The common case stays as
  fast as the old per-step checkbox.
- Steps marking no tests get a plain **Done**.

### Reporting a failure

Choosing fail opens a dialog:

1. **What went wrong** — free text, required.
2. **Screenshot** — drop or paste.
3. **Can you keep going?** — an explicit two-way choice:
   - *Yes, carry on* — the rest of the flow still works.
   - *No, I'm stuck* — remaining steps become blocked.

### Why the tester decides whether a failure blocks

The naive options both lose information.

*Hard stop on any failure* is honest but expensive: one cosmetic bug kills the remaining eighteen
steps and everything they would have verified. Most failures are local — a wrong label, a broken
tooltip — and have no bearing on the rest of the path.

*Always continue* is optimistic and produces false data: when a failure genuinely wedges the app,
every subsequent step is unverifiable, and recording anything about them is a lie.

Letting the tester choose costs one click at the moment they already have the most context, and
yields accurate data about what was actually verified. Blocked steps are marked *blocked*, visually
dimmed, and their tests report as not verified rather than as failures.

---

## Progress

A footer tracks the flow live: passed, failed, minor, skipped, and how many tests remain. The
testing day page aggregates the same across all flows, including how many tests were never reached.

"Not reached" is a first-class outcome. A test nobody got to is neither passed nor failed, and
collapsing it into either would misrepresent the day.
