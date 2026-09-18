# Domain Model

---

## Entity map

```
Product
 ├── Test ──────────── TestVersion (immutable snapshots)
 └── Template
      └── Flow
           └── Step ──── marks ──▶ Test   (many-to-many)

Run  ──▶ instantiates a Template snapshot
 └── FlowRun (claimed by one tester)
      └── TestResult ──▶ pins a TestVersion
```

---

## Product

A standalone system under test. Products are fully independent — different systems, different
teams, no shared data. Everything else in the model lives under exactly one product.

| Field | Notes |
|---|---|
| `id`, `name` | |
| `description` | Short blurb |

The system is explicitly multi-product from day one. There is no "default product" shortcut.

---

## Test

**A test is an assertion, not a procedure.** It states what must be true. It contains no steps,
because the steps now live in flows.

| Field | Notes |
|---|---|
| `id` | Stable, permanent. Flows reference this. |
| `productId` | |
| `currentVersionId` | Points at the latest version |
| `archived` | Soft-delete flag |

### TestVersion

| Field | Notes |
|---|---|
| `id` | Version identity. Results pin this. |
| `testId` | |
| `title` | e.g. "Sending a message shows it optimistically" |
| `expectedResult` | e.g. "Appears immediately with a pending clock icon" |
| `metadata` | Open key/value bag — see below |
| `createdAt`, `createdBy` | |

**Metadata is deliberately generic.** Only title and expected result are structural. Everything else
— priority, tags, category, a reference screenshot of the expected result — goes into an extensible
bag so fields can be added without a schema migration. We are not designing those fields now; we are
making sure adding them later is cheap.

### Why tests have no steps

This was a deliberate choice with a real cost, taken with eyes open.

If a test kept its own steps *and* flows described the path, the same procedure would exist in two
places and drift apart within a release or two. The document would say one thing, the flow another,
and nobody would know which is authoritative.

The cost: migrating the Confluence suite is a rewrite, not a copy-paste. Each table row has to be
split — its assertion becomes a test, its steps get folded into whichever flow naturally passes
through that part of the product. A test is also no longer runnable on its own; it only becomes
executable when a flow marks it.

We accepted both costs. Single source of truth for the procedure is worth more than a cheap
migration.

---

## Test identity and versioning

Tests are **immutable at the version level and stable at the identity level**. This is two-level on
purpose.

- **Editing a test creates a new version.** The old version is never modified and never deleted.
- **Flows reference the test ID**, not the version. They always resolve to the current version.
- **A result pins the version ID** it was executed against, at the moment of execution.

### Why not "an edit creates a new test with a new ID"

That was the first proposal, and it is simpler. It fails on a practical detail: every flow that
marked the old test would now point at an archived object. Fixing a typo in a test marked by six
steps across two templates would mean hunting down six references and repointing them by hand, and
coverage would break every time someone corrected a word.

The two-level split gives the same immutability guarantee without that cost. Last March's run says
"passed T-11 v3", and v3's exact wording is readable forever, while today's flows silently use v7
with nobody repointing anything.

### Deletion

Deleting archives the test. It stops counting toward coverage, existing marks in flows render as
"archived test", and historical runs remain intact. Hard deletion is never offered — a test
referenced in six flows and three historical runs cannot be safely erased.

---

## Template

A reusable definition of a testing day for one particular setup.

| Field | Notes |
|---|---|
| `id`, `productId`, `name`, `description` | |
| `status` | `active` or `archived` |
| `flows[]` | Ordered for display only |

**A template's test scope is implicit.** The author never declares "this template is responsible for
these 40 tests". They write flows, mark tests on steps, and the scope is whatever those marks add up
to. Declaring scope separately would create a second list to maintain and a new way to be wrong.

**Templates may exist and never run.** Legacy templates for features no longer shipped, or ones
simply forgotten, still count toward coverage. A test marked only by a never-run archived template
is *covered* — the system's coverage question is "is this reachable by some flow somewhere", not
"was this executed recently".

Multiple templates per product is the norm: one per setup. Some tests are only performable in one
configuration, others in another, so those become separate templates.

---

## Flow

A single continuous human path through the product.

| Field | Notes |
|---|---|
| `id`, `templateId`, `name` | |
| `precondition` | Free text: "Relay uninstalled. You have QA credentials." |
| `estimatedMinutes` | **Optional.** A hand-typed guess, editable. Not derived from run history. |
| `archived` | Soft-delete flag, as on tests (D7). An archived flow leaves new testing days; its marks still count toward coverage (D3) and past days keep their results. |
| `steps[]` | Ordered. Order is meaningful — this is a sequence. |

A flow is the unit of work on a testing day. It is stateful and continuous: it assumes the product
is left in whatever condition the previous step created.

**Flows are unordered and independent within a template.** Any tester can take any flow at any time.
Setup requirements are expressed as free-text preconditions rather than enforced dependencies —
real dependency graphs would serialize seven people and destroy the parallelism that makes the
testing day finish in a day.

Resetting state is expected and fine. When a sequence cannot continue from the current state, that
is simply a new flow with its own precondition.

---

## Step

| Field | Notes |
|---|---|
| `id`, `flowId`, `order` | |
| `kind` | `action` or `assertion` |
| `text` | What the tester does or checks |
| `expectedResult` | Shown for assertions |
| `deviceLabel` | Free text, see below |
| `marks[]` | Zero or more test IDs |

### Step kinds

- **Action** — something the tester performs. "Tap Sign in."
- **Assertion** — something the tester only looks at. "The error appears under the password field."

The distinction matters during execution: an action is work, an assertion is judgment. A tester
skimming a flow needs to see instantly which is which, and they are visually distinct.

### Devices

A device label is **free text**. It can be abstract ("Device A", "Device B") or concrete
("Pixel 8", "Dana's laptop"). The system does not maintain a device taxonomy.

**Devices are introduced mid-flow, at the step that first needs them.** A flow can start with one
device and pick up a second halfway through. The step that introduces a device is rendered as a
prominent hand-off banner.

*Fallback:* if introducing devices mid-flow proves confusing in practice, the fallback is declaring
all devices up front on the flow so the tester gathers hardware before starting. The demo shows both
— an up-front device list on the flow header and the mid-flow banners — so the fallback is already
half-built.

**Multi-device flows are single-tester.** One person, several devices on the desk. The device label
tells them which screen to touch. Two people coordinating in real time is explicitly out of scope;
it would break single ownership and require live multiplayer.

### Marking tests

A step marks zero or more tests. Marking means: *when the tester completes this step, these
assertions have been verified.*

- **Zero tests** is normal. Navigation and setup steps verify nothing.
- **Multiple tests** on one step is normal. A single check can confirm several assertions.
- **The same test marked in several flows** is allowed and unrestricted. Natural human paths
  overlap; forbidding overlap would force authors into unnatural contortions. See
  `04-coverage-and-reporting.md` for how conflicting results resolve.

---

## Run

An instantiation of a template on a specific testing day. The template is the class; the run is the
object.

| Field | Notes |
|---|---|
| `id`, `templateId`, `date` | |
| `templateSnapshot` | Frozen copy taken at start |
| `flowRuns[]` | |

**A run pins a template snapshot at start.** Without this, an edit to a flow mid-day reshuffles the
checklist of a tester who is on step 14. Same mechanism as test versioning, same reason.

**Runs stay open indefinitely.** A testing day may span several sittings; the run does not close at
end of day.

**Runs are read-only executions.** A tester cannot edit the template during a run. When they find a
stale or wrong step, the *skipped* verdict is the feedback channel — it already means exactly "this
test no longer matches reality" and carries a note.

### FlowRun

| Field | Notes |
|---|---|
| `flowId`, `runId` | |
| `claimedBy` | One tester |
| `state` | `open`, `claimed`, `finished`, `abandoned`, `released` |

**A FlowRun is per tester, not per flow.** Two testers may run the same flow in the same run; each
produces an independent FlowRun with its own results. Neither overwrites the other.

**Claims are advisory, not exclusive.** A claim signals "someone is on this" — it does not lock the
flow. Anyone may take a flow that is already claimed; the UI shows who holds it and how far they got,
and asks for confirmation first so it never happens by accident. Nobody is kicked off.

Deliberate double-running is a feature: for a flow covering core logic, two independent passes give
two validations. This composes with worst-result-wins (see `04`) at no extra cost — if one tester
hits a bug and the other does not, the day reports the failure.

**A partially-executed flow does not survive a break.** Runs stay open across days, but when a flow
is left mid-way and picked up later, it restarts from step 1. See `03-execution.md` for why.

### TestResult

| Field | Notes |
|---|---|
| `testId`, `testVersionId` | Version pinned at execution |
| `stepId`, `flowRunId` | |
| `verdict` | `pass`, `fail`, `minor`, `skipped` |
| `note` | Required for fail, skipped; optional for minor |
| `attachments[]` | Screenshots |
| `blocking` | Only for `fail` |
| `recordedBy`, `recordedAt` | |

**Results are recorded per test, not per step.** When one step marks three tests, the tester may
find two fine and one broken; a per-step verdict cannot express that. A "pass all" button on the
step keeps the common case to one click, so precision costs nothing in the normal path. Steps
marking no tests get a plain "done".
