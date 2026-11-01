# Decision Log

*Every decision taken, what was rejected, and why. D1–D31 and D40–D43 are the product; D32–D39 and
D44 are how it is built and run.*

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

### D29 — Import is a two-phase API using returned IDs *(superseded by D43)*

Bulk-create tests, then templates marking the returned IDs; not idempotent, so a re-run duplicated
everything. Replaced by keys and the suite document, which make a push idempotent.

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

---

### D41 — A step happens on one device; a device has one colour across its template

**Chosen:** Two rules that make the device system mean the same thing everywhere.

1. **One device per step, enforced by the editor rather than the schema.** A step whose text names
   another device in the template, or says "both screens", "each device" and the like, gets a warning
   badge in the editor, and its edit form offers *Save and add a step on …* to split it on the spot.
   A test that needs both screens is marked on both steps; worst-result-wins (D19) already combines
   them. A typed device label that matches a known one apart from case and spacing is saved as the
   known one, and a genuinely new label is called out as new before it is saved.
2. **Device colour and letter are assigned per template, not per flow.** Slots go by first appearance
   across the template's flows, in flow order (active flows first, which is exactly what a run's
   snapshot holds). The iPhone is teal on the board, the template page, the runner and the editor.

**Rejected:** (a) Multi-device steps (a list of devices per step). The question a step answers is
"which screen do I look at?"; two answers is no answer, and it is the confusion D18 exists to remove.
A comparison is written as a check on one device against what the tester saw on the other ("the 👍
you added on the iPhone, with a count of 1"). (b) Hashing labels to colours, the reason slots were
per flow in the first place: two labels can hash to the same slot. Template-wide first appearance
cannot collide — every new label takes the next slot. (c) Product-wide slots: a run only snapshots
its template, and a template is the unit a testing day shows.

**Why:** Per-flow slots meant teal was the iPhone in one flow and the second laptop in the next, on the
same board. A colour system that changes meaning between two rows is not a colour system.

**Accepted tradeoff:** A flow using only the Pixel and the second laptop shows A and C, not A and B.
Past the seventh device in a template, colours repeat (the letter still differs), as before.

---

### D42 — The board sees a running flow as it goes, provisionally

**Chosen:** Verdicts still stay a draft on the tester's device until Finish (Abandon still discards
them, so an abandoned flow leaves nothing behind). Alongside, the runner publishes a summary of the
draft to the flow run — the step the tester is on, a tally, where they are blocked, and every non-pass
with its note — a moment after each change. The board shows it under the flow as a dashed *running
now* row, and anything failed or flagged in a running flow at the top under *Going wrong right now*.
The claim dialog shows where each holder is and when they were last active. It is never counted in
the day's numbers, is cleared when the flow is finished or abandoned, and only the person who
claimed the flow can publish it.

**Rejected:** (a) Recording verdicts one by one again — that is what the draft replaced, because an
abandoned flow then showed up as passed. (b) Leaving the board blind until Finish: a blocking failure
on step 3 of a forty-step flow reached the coordinator hours late.

**Why:** The coordinator's question during the day is "is anything on fire?", not "what is the final
count?". The draft answers the first; only Finish should answer the second.

**Accepted tradeoff:** One stored derivation (`flow_run.progress`), against the schema's "nothing derived
is stored" rule — its source lives only in a browser, so there is nothing to derive it from server-side.

---

### D43 — Agents and people author a suite as files, pushed as one document by key

**Chosen:** Every product, test, template and flow has a readable **key** (`sign-in-rejects-a-wrong-password`;
a product's is its slug), unique in its scope, assigned from the name at creation and never changed by
a rename. A product's whole suite is one **document** addressed by those keys —
`GET /products/{product}/suite`, `POST …/suite/plan`, `PUT …/suite` — and the `flowdeck` CLI maps it
one-for-one onto a folder: a file per test, a folder per template, a file per flow, the file name being
the key. Steps say `do:` or `check:`, name one `device:`, and `verifies:` tests by key.

A push replaces the suite, matched by key: new keys are created, an edited test gets a new version,
and whatever the document leaves out is **archived, never deleted** (D7), so pushing it back restores
it. Steps have no keys; they are matched by content, so a surviving step keeps its id. A push names
the **revision** it was edited from and is refused if the suite has moved on; the CLI's `pull` then
merges per test and per flow, keeping both sides' edits and naming what both changed. The same rules
are linted offline and on the server: errors (bad keys, unknown tests) refuse the push; warnings
(a step on two devices, a step doing two things, a check with nothing to see, an uncovered test) are
said and allowed (D2). `flowdeck guide` explains the rules, and a pull writes them as `AGENTS.md`.

**Rejected:** (a) Agents driving the granular REST routes — dozens of calls holding UUIDs, no preview,
no way to review the change as a whole, and a half-applied change on any failure. (b) An MCP server as
the primary surface — tied to one kind of client; files plus a CLI serve agents, people, git and code
review at once. (c) Keeping the bundle import/export (D29) beside it — two formats for one thing; the
bundle created rather than merged, so it could not round-trip. (d) Hard-deleting what a push leaves out.

**Why:** Writing a manual-test suite is mostly writing — dozens of tests and long flows — which is what
agents and text editors are good at and what a form-per-row UI is slow at. Files give review (`push
--plan`, git diffs), bulk edits and an agent's whole toolbox; keys make the round trip exact and the
push idempotent; the revision check means nobody's app edit is silently overwritten.

**Accepted tradeoff:** Renaming a file is a new key — the old thing is archived with its history and a
new one starts. That is said in the guide and visible in the plan (`-` and `+`), rather than guessed at.
The web app's editor stays the live, one-step-at-a-time surface; the two meet through the revision
check.

---

## Building it: stack and platform

*Seven users, realtime that only flows one way (one tester owns a flow), self-hosted possibly on a
closed network, and a public REST contract that scripts code against. Those four facts drove these.*

Bun · Hono + `@hono/zod-openapi` · PostgreSQL 17 (logical replication) · Drizzle · ElectricSQL ·
React 19 + Vite + TanStack Router/Query/DB · Tailwind v4 · Radix · dnd-kit · Zod · bun test +
fast-check + Playwright · docker compose with Caddy for TLS and HTTP/2.

---

### D32 — ElectricSQL for the realtime read path

**Chosen:** ElectricSQL syncs Postgres queries to the browser. Writes continue to go through our own
REST API.

**Rejected:** (a) hand-rolled SSE with an event log and sequence numbers; (b) Socket.IO;
(c) Rocicorp Zero.

**Why:** Realtime plumbing that is *almost* correct is worse than none — a flow board showing a
stale claim causes two people to unknowingly run the same flow. Reconnection, offsets, resume after
a gap, and initial-snapshot-then-delta are exactly the parts that are easy to get subtly wrong, and
Electric is a component whose entire job is getting them right. Zero is nicer to write against but
is pre-1.0, and this is a system the team will depend on.

**How it actually splits.** This is the part that shapes the codebase:

- **Reads that must be live** are *shapes* — a table plus a `where` clause, streamed over HTTP with
  Electric handling offsets and resume. The client subscribes; rows arrive and keep arriving.
- **Writes are ordinary `POST`/`PATCH`** against the Hono API, which validates, applies business
  rules, and writes to Postgres. Electric notices the change through logical replication and pushes
  it to every subscriber, including the writer.
- The writer does not wait for that round trip: the mutation is optimistic locally, and the echoed
  row reconciles it.

So Electric replaces the *push* half of the system and nothing else. The REST contract survives untouched.

**Consequences accepted:** Postgres with logical replication is now required, so the single-binary
idea is dead and deployment is compose. Electric is a second service to run and upgrade. Shape
queries are per-table with a `where` clause, so anything aggregate is either a database view synced
as its own shape or computed client-side.

---

### D33 — Electric on the live surfaces only; REST everywhere else

**Chosen:** Shapes for the testing-day board, the flow runner, coverage state, and editor presence.
Plain REST + TanStack Query for authoring, the test library, run reports and dashboards.

**Rejected:** Syncing every read through Electric.

**Why:** Two mechanisms, each used where it is obviously right. Report and dashboard queries are
aggregates over joins — pushing those through per-table shapes means reassembling them in the
browser, which is more code and slower than one SQL query. Nothing on a report needs to update while
you watch it.

| Surface | Mechanism |
|---|---|
| Testing-day board — claims, progress, counts | Electric |
| Flow runner — results, blocked steps, presence | Electric |
| Coverage state in the library | Electric |
| Flow editor — presence and other authors' edits | Electric |
| Test library list, test detail, version history | REST |
| Run reports, issue feed, dashboards | REST |
| Everything under `/api/*` for external adapters | REST |

**Authorization:** shape requests are proxied through the Hono API rather than exposing Electric
directly, so there is one origin, one place that decides what a client may subscribe to, and no
second service on the network edge.

---

### D34 — Bun

**Chosen:** Bun as runtime, package manager and test runner.

**Why:** Fast installs and test runs, native workspaces, and a good dev loop. It was originally
chosen to get a single executable; that reason went with D32, and it stays on its own merits.

**Accepted tradeoff:** a younger runtime than Node. The blast radius is small — Hono, Drizzle, Zod,
React and Electric's client all run unmodified on Node, so the escape hatch is changing a base image.

---

### D35 — Hono, and REST only

**Chosen:** Hono with `@hono/zod-openapi`; the web app consumes the same public REST API that
external adapters do, through a client generated from the OpenAPI document.

**Rejected:** tRPC for the UI alongside REST for integrations.

**Why:** Two API styles means two contracts, and the second is always the one that rots. Making the
UI the heaviest consumer of the public API means it is exercised constantly and its breakages are
noticed immediately. `@hono/zod-openapi` derives the document from the same Zod schemas that
validate requests, so it cannot drift.

---

### D36 — Verdict writes are idempotent

**Chosen:** Every result write carries a client-generated idempotency key; the server upserts on it.

**Why:** A tired tester on a laggy connection taps the tick twice. Without a key that is two rows, a
double-counted verdict, and a corrupted progress number. Costs one column and one unique index.

---

### D37 — Concurrent authoring: presence plus last-write-wins per step

**Chosen:** The flow editor shows who else is in it. Edits are scoped per step, so two authors
touching different steps never conflict; two on the same step resolve last-write-wins.

**Rejected:** (a) an advisory lock like flow claiming; (b) a hard read-only second author.

**Why:** With seven people this collides approximately never, and Electric already delivers the other
author's changes live, so the second author watches the flow update rather than discovering a
conflict on save. A hard lock reproduces exactly the problem D26 rejected for flows — somebody leaves
the editor open and nobody else can work.

---

### D38 — Identity is a name picker

**Chosen:** First visit asks who you are and offers the names already seen on this instance. Stored
in a signed cookie, written to every `recorded_by` and `claimed_by`.

**Why:** The self-serve spirit of D30 and D24 — seven people in one room, no roles, every change
attributed. Real authentication would add password resets, session security and an IdP dependency to
counter a threat that does not exist inside this team.

Trivially spoofable, and that is understood. It sits behind an `Actor` interface, so dropping in OIDC
later touches one module and changes no call sites.

---

### D39 — A palette of seven device colours

**Chosen:** Seven device slots, assigned by order of first appearance (since D41, across the
template rather than per flow).

**Rejected:** Hashing labels to colours — two labels can hash to the same slot, and two adjacent
steps in indistinguishable colours is exactly the confusion this product exists to remove. An eighth
slot — red, amber, green and slate-blue are spoken for by the verdicts, and every candidate sat within
about 20° of something it would be confused with.

**Why:** Device labels are free text and unbounded (D16), so the original four colours left a fifth
device undefined. `devices.test.ts` enforces the hue separation, so an eighth can be added the day
someone finds one that passes.

**Known, not fixed:** the inherited ochre device colour sits close to the minor-verdict amber, and the
magenta near the fail red; a test pins both so a change is deliberate.

---

### D44 — Backups go to the network's own S3, as a dump plus the data volume

**Chosen:** A `backup` sidecar in the compose stack runs `pg_dump` on an interval and ships
the dump together with the `data` volume (attachments, cookie secret) to an S3 bucket inside
the team's network, using restic: encrypted before leaving the host, deduplicated, with a
retention policy. Restore is one script that works on a fresh machine or over a running one.

**Rejected:** (a) snapshotting the Postgres volume directly — a copy taken under writes is
torn and may not start; (b) public cloud object storage — the attachments are screenshots of
the product under test, and self-hosting rules out data leaving the boundary; (c)
continuous WAL archiving (pgBackRest, WAL-G) — point-in-time recovery, but real operational
weight for a system where losing part of one testing day is the acceptable worst case.

**Why both halves together:** attachment rows in the database reference files on disk by
hash. A database-only backup restores failures whose screenshots are gone; a files-only
backup restores screenshots nothing points at. One snapshot holds both, taken seconds apart.

**Consequence to know about:** a restore drops Electric's replication slot, because the
restored database has a different history than the one Electric was following. Electric is
recreated afterwards so it forgets the shapes it cached. `docs/backup.md` has the steps.
