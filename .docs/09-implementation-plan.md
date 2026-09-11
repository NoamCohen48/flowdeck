# Implementation Plan

*The stack, the realtime design, the schema, and the order things get built. Decisions here are
numbered D32 onward and can be folded into `06-decision-log.md`.*

---

## Constraints that drove the choices

Four facts about this system decide almost everything:

1. **Seven users.** Write volume is a verdict every minute or two. This is not a scale problem, and
   any choice justified by scale is justified by nothing.
2. **Realtime is one-directional.** The docs deliberately rule out collaborative editing — one tester
   owns a FlowRun (D9), multi-device is single-tester (D15), runs are read-only (D20). Nobody edits
   the same object as somebody else at the same moment. **There is no CRDT problem here.**
3. **Self-hosted, possibly classified.** No hosted realtime service, no CDN, no external font host.
4. **A public REST contract already exists.** `08-api-and-integration.md` commits to endpoints that
   external import and adapter scripts code against. The API is a product surface, not an internal
   detail.

---

## The stack

| Layer | Choice |
|---|---|
| Runtime | **Bun** (also the package manager and test runner) |
| HTTP | **Hono** + `@hono/zod-openapi` |
| Database | **PostgreSQL 17** (`wal_level=logical`) |
| Data access | **Drizzle ORM** + plain SQL migrations |
| Realtime | **ElectricSQL** shapes for the live read path |
| Frontend | **React 19** + **Vite** + **TanStack Router** + **TanStack Query** |
| Styling | **Tailwind v4**, tokens lifted from `flowdeck-demo.html` |
| Primitives | **Radix** (dialog, popover, focus) — no component library |
| Drag and drop | **dnd-kit** |
| Validation | **Zod**, shared between client and server |
| Tests | **Vitest** + **fast-check**; **Playwright** for multi-context E2E |
| Deployment | **docker compose** — postgres, electric, app, caddy |

TypeScript throughout, one Bun workspace.

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

So Electric replaces the *push* half of the system and nothing else. The REST contract in `08`
survives untouched.

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
chosen to get a single executable; that reason is gone with D32, and it stays on its own merits.

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

## Repository layout

```
flowdeck/
├── packages/
│   ├── domain/        pure TypeScript, zero dependencies
│   └── api-client/    generated from the OpenAPI document
├── apps/
│   ├── server/        Hono, Drizzle, migrations, shape proxy
│   └── web/           React, Vite
├── compose.yaml       postgres · electric · app · caddy
└── .docs/
```

### `packages/domain` carries the rules

Dependency-free on purpose, so server and browser import the *same* implementation of every rule
that matters:

| Export | Rule |
|---|---|
| `computeHandoffs(steps)` | Which step introduces each device label |
| `worstResult(verdicts)` | `fail > skipped > minor > pass` (D19) |
| `coverageOf(test, marks)` | Covered if marked anywhere, archived templates included (D3) |
| `verdictRequiresNote(v)` | Fail and skipped require a note (D13) |
| `blockedStepsAfter(step)` | Blocking failure propagation (D11) |
| `deviceColor(slot)` | Palette slot → colour (see D39) |

The API contract lives in `apps/server/src/http/schemas.ts` rather than here, because
it needs Zod and this package stays dependency-free. The web app does not import those
schemas either — it consumes a client generated from the OpenAPI document, so there is
one contract and the UI exercises the same API the adapters do (D35).

**`computeHandoffs` is the one to be careful about.** `07-open-items.md` calls it out: a hand-off
banner is derived state — "the first step using this device label" — and every insert or reorder can
move it. The failure mode is a step appearing above the banner that introduces its own device, which
is silently wrong and looks fine.

Making it a pure function of the step list, **recomputed on every render rather than stored**,
removes the class of bug entirely: there is no stored banner that can become stale. It gets
property-based tests (fast-check):

- for any step list and any reorder, every step's device is introduced at or before that step;
- exactly one introduction per distinct device label;
- recomputing after an insert equals recomputing from scratch.

---

## Schema sketch

Following `01-domain-model.md`. Notable columns only.

```sql
product         (id, name, description)
test            (id, product_id, current_version_id, archived)
test_version    (id, test_id, title, expected_result, metadata JSONB, created_at, created_by)
template        (id, product_id, name, description, status)
flow            (id, template_id, name, precondition, estimated_minutes NULL, position)
step            (id, flow_id, position, kind, text, expected_result, device_label, updated_at)
step_mark       (step_id, test_id)                       -- the many-to-many

run             (id, template_id, date, template_snapshot JSONB)
flow_run        (id, run_id, flow_id, claimed_by, state)
test_result     (id, flow_run_id, step_id, test_id, test_version_id,
                 verdict, note, blocking, recorded_by, recorded_at, idempotency_key)
attachment      (id, test_result_id, sha256, mime, bytes, width, height)
presence        (actor, scope, last_seen_at)             -- synced as a shape
```

- `test_result.idempotency_key` carries a unique index — see D36.
- `attachment` rows are metadata; the files are content-addressed on a mounted volume, served by the
  API. Large binaries stay out of Postgres and out of logical replication.
- `template_snapshot` is the frozen copy from D21. A run reads its steps from here, never from the
  live template.
- `presence` is a tiny table with a TTL sweep, synced as a shape — the cheapest possible presence
  given Electric is already there.

**Coverage is a database view, not a stored flag.** At library sizes in the hundreds a `LEFT JOIN`
from `test` through `step_mark` reporting `archived = false AND mark IS NULL` is instant, and a
derived value cannot go stale. The view is synced as a shape so the library's red rows update live,
and `GET /api/products/{id}/coverage` reads the same view — during migration that endpoint is the
progress bar `08` describes.

**Worst-result-wins is one `CASE` expression** ordering `fail > skipped > minor > pass`, defined once
in `packages/domain` and once in SQL, with a test asserting the two agree.

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

## Design: matching the demo

`flowdeck-demo.html` is the visual specification. Its CSS is already a clean token system — four
device colours, four result colours, hairline borders, one shadow — and lifts almost line-for-line
into a Tailwind v4 `@theme` block. The React components reproduce its layout, spacing and components
faithfully.

### Defects fixed without asking

These are not design changes; the demo is wrong or incomplete on them.

1. **IBM Plex Sans is self-hosted.** The demo loads it from Google Fonts. An external CDN is
   unacceptable for an air-gapped or classified deployment, and the font would silently fall back to
   system-ui — changing every metric in the design.
2. **Verdict buttons are 30×27px.** Below any touch-target minimum, in a product whose own
   accessibility notes say testers may record results on a phone. They grow at narrow widths.
3. **The focus ring uses `--dev-a`.** Violet means "Pixel 8" everywhere else in the product;
   using it for focus conflates the two. Focus gets its own neutral token. Same fix for
   `.step.now`, whose violet ring collides with device A's own colour.
4. **`dir="auto"` on every user-authored string** — test titles, step text, preconditions, failure
   notes — so Hebrew content renders correctly inside an English interface.
5. **The failure dialog handles multiple attachments**, gallery upload and camera capture, per the
   agreed answer. Images are downscaled to ~1600px and re-encoded client-side before upload; phone
   photos arrive at 3–12MB and there is no reason to store that.
6. **A configurable attachment disk budget** with a dashboard warning as it is approached. Nothing is
   ever deleted automatically.

### Improvements approved

*None are required by the docs; all four were approved.*

| # | Proposal | Why |
|---|---|---|
| I1 | **Dark theme** ✓ | A tester three hours into a testing day, possibly in a dim lab. The demo is already fully tokenised, so this is a second `@theme` block, not a redesign. |
| I2 | **Keyboard-driven runner** ✓ | `j`/`k` to move, `p` to pass-all, `f` to fail, `?` for help. Over four hours and several hundred steps, on a laptop, this is a large cumulative saving on the product's most-used screen. |
| I3 | **Jump-to-current-step, and the editor's step map reused in the runner** ✓ | `07` already specifies a titles-only sidebar for the editor. The same component in the runner gives a tester who has scrolled away a way back, and an at-a-glance sense of what remains — which the docs say is asked constantly. |
| I4 | **A device palette larger than four, deterministically assigned** ✓ | Device labels are free text and unbounded (D16), but the design defines exactly four colours. A flow using five devices had no defined behaviour. Built as D39 below — which changed on contact with the colour maths. |

**Live presence is not on this list** because it follows from the realtime requirement rather than
being an addition: who else is on the run, who holds a flow, who is in the editor (D37).

---

### D39 — Device slots by order of appearance, and a palette of seven

Two corrections to I4 as proposed, both found while building it.

**Assignment is by order of first appearance in the flow, not by hashing the label.**
Hashing was the proposal, and it has a real attraction: a device would keep the same
colour across every flow. But two labels in one flow can hash to the same slot, and two
adjacent steps in indistinguishable colours is precisely the confusion this product
exists to remove. Order of appearance cannot collide within a flow and reproduces the
demo's A/B/C/D. Cross-flow consistency is given up; the device *name* is shown
everywhere, so nothing is actually lost.

A visible consequence: letters are per-flow handles. The demo's fourth flow uses
devices it labels A and D, with no B or C on screen; under order-of-appearance it shows
A and B. That reads better, and a flow that jumps from A to D with nothing between
would be a small puzzle for a tester to solve for no reason.

**Seven slots, not eight.** Hue space is more crowded than it looked. Red, amber, green
and slate-blue are spoken for by fail, minor, pass and skipped; violet, teal, ochre and
magenta by the inherited device colours. Every candidate for an eighth sat within about
20° of something it would be confused with, so the palette stops at seven rather than
shipping a slot that reads as a verdict. `devices.test.ts` enforces the separation, so
an eighth can be added the day someone finds one that passes.

**An inherited collision, flagged rather than fixed.** The demo's own ochre (`--dev-c`,
hue 30) sits 8° from the minor amber `#A66A00`, and its magenta (`--dev-d`, hue 332) is
28° from the fail red `#C22F2F`. A device C chip beside a minor-verdict pill is
genuinely hard to tell apart. Matching the demo was the instruction, so both stand,
pinned by a test that documents them — but this is worth a decision.

---

### Noted inconsistencies in the docs

- The document map in `00` says the demo lives "in the parent folder"; it is in `.docs/`.
- The demo's seed data is internally inconsistent: the library view offers an
  "Uncovered only (1)" filter, but all 25 of its tests are marked by some flow. The
  seed adds a 26th test that nothing marks, so the red row and the needs-attention
  panel have something to render.
- UI copy in `03` and `04` uses short test handles — *"T-42 is marked by 3 flows"* — and the API
  example in `08` uses `T-10`. The agreed decision is opaque IDs with titles shown in the UI, so that
  copy needs rewording. Flagging rather than reopening.

---

## Build order

Each milestone is independently demonstrable. Full build before anyone uses it, so the sequence is
about dependency order and about de-risking early, not about shipping slices.

**1 — Foundations.**
Workspace, compose stack, Postgres with logical replication, Electric, migrations, `packages/domain`
with its rules and property tests, and the demo's fictional Relay data as a seed. Plus a generated
volume dataset — 300 tests, 50-step flows — so the editor sidebar and dashboards are verified at
scale rather than at demo scale.

**2 — Authoring API and coverage.**
Two-level test versioning, templates, flows, steps, marks, the coverage view. Ships the OpenAPI
document, which **unblocks the Confluence parser you are writing** — likely the longest-lead item in
the project, so it should not wait for the UI.

**3 — Execution and realtime.**
Runs, snapshots, advisory claiming with its confirmation (D26), per-test verdicts, blocking
propagation, and the first Electric shapes. *This is the surface seven people stare at for four
hours* and it is built before any authoring UI. Its E2E test drives two browser contexts and asserts
one sees the other's claim land.

**4 — Authoring UI and the flow editor.**
The one genuinely unbuilt feature from `07`: insert anywhere, the between-steps affordance,
drag-and-drop in the main column and in the titles-only sidebar, click-to-scroll, editor presence.
Hand-offs recompute from `packages/domain` on every change.

**5 — Issue feed and import.**
`GET /api/runs/{id}/issues` typed `failure | minor | invalid_test` (D28), the two-phase import (D29),
and the in-app "copy as ticket" action.

**6 — Dashboards and reports.**
Product overview, test library with coverage chips, testing-day board, per-test history over time.

---

## Verification

There is one developer and one reviewer and they are the same, so the test suite is the reviewer.

- **`packages/domain` is property-tested** with fast-check. Handoff recomputation, worst-result-wins
  and blocking propagation are pure functions with invariants, and invariants are what property tests
  are for.
- **API contract tests** run against the generated OpenAPI document, so a schema change that breaks
  an external adapter fails a test rather than someone's import script.
- **Playwright drives a full testing day**, multi-context: two testers, one claiming a flow the other
  holds, verdicts appearing live on the second screen, a blocking failure dimming the rest of a flow.
  This is the test that proves the Electric wiring actually works, and it is the one that matters.
- **GitHub Actions** runs all of it on every push to the private `flowdeck` repository.

---

## Risks

| Risk | Mitigation |
|---|---|
| Electric is a young dependency | Read path only; if it fails, the fallback is polling those same queries through the existing REST API — degraded, not broken |
| Handoff recomputation bug | Pure function, computed never stored, property-tested (`07` flags this) |
| Bun maturity | Every library also runs on Node; the escape hatch is a base image change |
| Confluence migration is a rewrite | Accepted in D4; the API lands at milestone 2 so the parser can be written in parallel |
| Mid-flow device introduction confuses testers | Fallback already agreed in D17 and half-built |
| Realtime appears connected but is stale | Electric's offsets handle it, and the UI shows an explicit reconnecting state — never a false green |
