# Decision Log

*Every decision taken during the design conversation, what was rejected, and why.*

---

### D1 — Coverage is enforced at the product level, scope is implicit per template

**Chosen:** A template's scope is whatever its flows mark, with no up-front declaration. Coverage
warnings are computed across all templates of a product.

**Rejected:** Templates declaring their responsible test set explicitly; coverage checked per
template.

**Why:** Explicit scope is a second list to maintain and a second way to be wrong. Per-template
warnings would fire constantly, since a template targeting one setup can only reach a slice of the
library — the warnings would mean nothing and be ignored.

---

### D2 — Uncovered tests warn but do not block

**Chosen:** A test in no template shows as an error state; it remains legal.

**Why:** Uncovered tests happen legitimately — aspirational tests, unreleased features, backlog.
The requirement is awareness, not prohibition.

---

### D3 — Unused and archived templates still count toward coverage

**Chosen:** A test marked only by a never-run legacy template is covered.

**Why:** Coverage asks "is this reachable by a flow", not "was it run recently". Recency is a run
question with its own reporting. Some templates are archives or forgotten legacy and that is fine.

---

### D4 — A test is an assertion with no steps

**Chosen:** Title, expected result, and extensible metadata. All procedure lives in flows.

**Rejected:** Tests keeping their own steps as reference documentation, with flows duplicating them
in a smoother order.

**Why:** Two copies of the same procedure drift apart within a release, and nobody knows which is
authoritative. Accepted costs, explicitly: migrating Confluence is a rewrite rather than a
copy-paste, and a test is no longer runnable on its own.

---

### D5 — Test metadata is a generic extensible bag

**Chosen:** Only title and expected result are structural. Priority, tags, category, an expected-result
screenshot and anything else go in an open bag.

**Why:** Those fields are wanted eventually but not now. Building the storage and UI generically
makes adding them a configuration change rather than a migration.

---

### D6 — Two-level test identity: stable ID plus immutable versions

**Chosen:** A test has a permanent ID that flows reference. Editing creates a new immutable version.
Results pin the version they executed against.

**Rejected:** (a) mutable tests with no history; (b) an edit creating a wholly new test with a new
ID.

**Why:** History fidelity matters — "what exactly did we verify in March" must be answerable.
Option (b), the first proposal in conversation, gives immutability but breaks every flow reference on
every edit: a typo fix in a test marked by six steps means six manual repointings, and coverage
breaks each time. The two-level split gives the same guarantee with none of that cost.

---

### D7 — Deletion archives rather than erases

**Chosen:** Archived tests stop counting toward coverage; flow marks render as archived; historical
runs stay intact.

**Why:** A test referenced across flows and historical runs cannot be safely hard-deleted.

---

### D8 — A template is a class, a run is an instance

**Chosen:** Templates are reusable definitions. Starting a testing day creates a run holding that
day's results. History is preserved per run.

---

### D9 — One tester owns a flow, start to finish

**Chosen:** Flow is the unit of assignment; testers claim unclaimed flows.

**Rejected:** Everyone runs everything (redundant, wastes the day); free-for-all with no ownership.

**Why:** A flow is a single continuous stateful session on one set of hardware. It cannot be split.

---

### D10 — Abandoning a flow restarts it from step 1

**Why:** Partial state created by someone else is not trustworthy, and a flow's later steps depend on
the state its earlier steps produced.

---

### D11 — On failure, the tester declares whether it blocks the rest

**Chosen:** A two-way choice in the failure dialog. Blocking marks remaining steps as blocked, and
their tests report as not verified.

**Rejected:** (a) hard stop on every failure; (b) always continue.

**Why:** Most failures are local and should not kill eighteen remaining steps. Some genuinely wedge
the app, and recording anything about subsequent steps would be false. One click at the moment of
maximum context buys accurate data.

---

### D12 — Results are recorded per test, not per step

**Chosen:** Each attached test gets its own verdict, with a "pass all" shortcut on the step and a
plain "done" for steps marking nothing.

**Rejected:** One verdict per step, inherited by all its tests.

**Why:** A step marking three tests can produce two passes and a failure; a per-step verdict cannot
express that and would mark all three failed. The shortcut keeps the common path at one click, so
precision is free.

---

### D13 — Four result states

**Chosen:** pass, fail, minor, skipped.

- **Pass / fail** — definitive statements about the product.
- **Minor** (amber) — something was off but not breaking. **Counts as verified and covered.**
- **Skipped** (grey) — the test itself is wrong or stale. **A separate category, not a verdict.**
  Does not count as verified.

**Why:** Real testing days produce outcomes that are neither clean passes nor real bugs. Collapsing
them into pass or fail destroys information. Skipped is on a different axis entirely — it describes
the suite, not the product — so it is grey rather than a status colour.

Failures require a written explanation and support a screenshot. Skipped requires an explanation.

---

### D14 — Steps are typed as action or assertion

**Chosen:** Action (perform) and assertion (observe), visually distinct, with expected results shown
only on assertions.

**Why:** They demand different behaviour from the tester — work versus judgment — and a tester
skimming a long flow needs to see which is which instantly.

---

### D15 — Multi-device is single-tester

**Chosen:** One person with several devices on the desk. Device labels tell them which screen to
touch.

**Rejected:** Two testers coordinating in real time.

**Why:** Multi-tester coordination breaks single flow ownership and requires live multiplayer — a
large amount of machinery for a case the team does not actually need.

---

### D16 — Device labels are free text

**Chosen:** Any label — "Device A", "Pixel 8", "Dana's laptop". No device taxonomy.

**Why:** Both abstract and concrete labelling are useful in different flows, and maintaining a device
registry is overhead for a seven-person team.

---

### D17 — Devices are introduced mid-flow

**Chosen:** A flow may start with one device and pick up more later, announced by a prominent
hand-off banner at the introducing step. The flow header also lists all devices used.

**Fallback, agreed in advance:** if mid-flow introduction proves disruptive, require all devices to
be declared up front so the tester gathers hardware before starting. The header list already
implements half of this.

---

### D18 — Multi-device is a first-class design priority

**Chosen:** The device hand-off banner is the loudest element in the product; device identity is
carried by colour, letter and name simultaneously, on every step.

**Why:** Explicitly the most confusing part of the existing suite. The design spends its attention
budget where the pain is.

---

### D19 — A test may be marked in many flows; worst result wins

**Chosen:** Unrestricted overlap. On the dashboard, `fail > skipped > minor > pass`.

**Rejected:** Forbidding a test from being covered twice within a template; warning on duplicates.

**Why:** Natural human paths overlap, and forbidding it would force authors into unnatural
contortions. A fail anywhere must not be buried by a pass elsewhere. All individual results remain
visible on the test detail view.

---

### D20 — Runs are read-only; skipped is the feedback channel

**Chosen:** Testers cannot edit a template mid-run. Stale steps are reported via the skipped verdict
with a note.

**Rejected:** (a) editing the template mid-run — mutates checklists under other testers; (b)
run-local ad-hoc steps and notes promotable to the template later — good, but a lot of machinery
for a first version.

**Why:** Skipped already means exactly "this no longer matches reality" and carries a note, so the
feedback path exists without new mechanics.

---

### D21 — A run pins a template snapshot at start

**Why:** Without it, an edit during the day reshuffles the checklist of a tester on step 14. Same
mechanism and same reasoning as test versioning.

---

### D22 — Flows are unordered, with free-text preconditions

**Chosen:** Any tester takes any flow at any time. Each flow carries a free-text precondition
describing its required starting state.

**Rejected:** (a) fully independent with no stated setup; (b) enforced dependencies where flow B
waits on flow A.

**Why:** Real dependency graphs serialize seven people and destroy the parallelism that makes the
day finish in a day. A precondition field solves the actual problem — knowing the starting state —
for almost no cost. Resetting state and starting over is expected, and is simply another flow.

---

### D23 — Multi-product from day one

**Chosen:** Products are fully independent, each with its own test library and templates.

**Why:** Stated requirement — completely different systems must coexist without shared data.

---

### D24 — Guardrails instead of roles

**Chosen:** No permission system. Everyone can edit tests and templates, start runs and record
results. Two destructive operations get a confirmation stating the consequence: archiving a test
(names how many flows mark it) and starting a run.

**Rejected:** (a) nothing at all; (b) maintainer/tester roles.

**Why:** Seven people on one team. Roles would block work whenever the one person with rights is
away, and every change is already attributed. Confirmations cover the two operations where a mistake
is expensive.

---

### D25 — Runs stay open across days; partial flows restart

**Chosen:** A run does not close at end of day. Unclaimed flows can be taken any time. A
partially-executed flow left over a break restarts from step 1, discarding its results.

**Rejected:** (a) resuming a half-finished flow where it stopped; (b) a run being one sitting, with
leftovers rolled into a new run.

**Why:** State, not policy. A flow's later steps depend on state its earlier steps built, and that
state does not survive overnight — reboots, expired sessions, the test account used by someone else.
Continuing from step 9 the next morning assumes a product state nobody verified, producing passed
results that mean nothing.

---

### D26 — Claims are advisory, not exclusive

**Chosen:** Claiming marks a flow as taken but does not lock it. An already-claimed flow can be
claimed by someone else, after a confirmation showing who holds it and their progress. Nobody is
kicked off. A FlowRun is per tester, so two people running the same flow produce two independent
result sets.

**Why:** Two reasons, one defensive and one positive. Defensively, a tester who claims a flow and
walks away without pressing abandon must not lock it away from everyone else. Positively, deliberate
double-running of an important flow — core logic, checked twice by two people — is *good*, and the
system should permit rather than prevent it. It needs no new machinery: worst-result-wins already
resolves disagreement between the two passes.

---

### D27 — Flowdeck integrates with nothing; it exports structured data

**Chosen:** An issue-feed API returning every non-pass result as self-contained JSON. External
adapters decide what becomes a Jira ticket, what becomes suite maintenance, and what is dropped.

**Rejected:** (a) no export, tickets filed by hand from the run report; (b) direct Jira integration.

**Why:** Per-tracker integration is heavy work that breaks when the tracker changes, and the team may
target different destinations over time. An export is also inspectable before anything leaves the
system, which matters for a classified product. An in-app "copy as ticket" action covers filing one
bug by hand.

---

### D28 — Flowdeck labels, the adapter filters

**Chosen:** Every non-pass result is exported, typed `failure`, `minor` or `invalid_test`. Flowdeck
applies no policy about what deserves a ticket.

**Why:** Routing policy belongs where it can be changed cheaply. Putting it in the adapter means
adjusting what gets filed never requires touching Flowdeck.

---

### D29 — Import is a two-phase API using returned IDs

**Chosen:** Bulk-create tests, take the returned IDs, then create templates whose steps mark those
IDs. Migration from Confluence — or Jira, or anywhere — is an external script against this API.
Flowdeck has no source-specific knowledge.

**Rejected:** Caller-supplied `externalId` making import idempotent and re-runnable.

**Why:** The two-phase flow is simple and the script holds the mapping. **Accepted tradeoff:** import
is not idempotent — running the parser twice duplicates everything, with no way for Flowdeck to
detect it. The practical answer during migration is wipe-and-reimport. `externalId` remains addable
later as an optional field without breaking callers.

---

### D30 — No notifications, no scheduling, no assignment

**Chosen:** Pure self-serve. The day opens, the flow list is visible, testers take what they want.

**Why:** Seven people in one room on testing day. Any push mechanism would be noise.

---

### D31 — Flow time estimates stay manual and optional

**Chosen:** A single optional free field the author types and can edit. Displayed unobtrusively.

**Rejected:** Deriving the estimate from the median of past runs, or seeding it manually and
replacing it with observed data.

**Why:** Durations are noisy — interruptions, twenty minutes spent writing up a bug — and a median of
four noisy samples is not clearly better than a careful guess. Deriving it would also require
deciding how to treat abandoned and blocked runs. Not worth the machinery; it is one field.

---

### D40 — A step can be flagged as wrong, and a step can say where it leaves you

**Chosen:** Two additions to the runner. A step carries an optional free-text *post state* —
"afterwards, you should be on the channel list". A tester can flag a step as wrong (*Step is wrong*),
saying what is wrong and whether they got past it: with a workaround, which is required and recorded,
or not at all, which blocks the rest of the flow like a blocking failure (D11). It is not a verdict;
the tests the step marks can still be recorded.

**Rejected:** Leaving *skipped* to cover it. Skipped is per test, and says the *assertion* is stale.
A stale *step* is a different thing: an action nobody can perform as written, possibly marking no
test at all, that stops the tester in the middle of forty steps and thirty other tests.

**Rejected:** A step-level verdict (pass/fail per step). It would reintroduce the per-step result the
model deliberately does not have (D12), and a flagged step whose tests all pass is the common case.

**Why:** In the old per-test model a tester who found a wrong step improvised — they knew the test's
intent and got there some other way. Splitting steps from tests removed the information they
improvised *from*: a step had an action and no destination. The post state gives the destination
back; the flag gives the maintainer the report, in the tester's words, at the moment they had the
most context. Same primitive as the failure dialog's "can you keep going?" — one click, no new
vocabulary.

**Accepted tradeoff:** Once improvisation is legal, a flow can rot while every run passes. Flag counts
are therefore shown per finished flow run and the report lists every flagged step under *Steps to
update*, so a half-improvised green day is visible as such.
