# The Flowdeck API

Flowdeck exposes one REST API. The web app uses it; so does the [`flowdeck` CLI](cli.md), an
agent, an issue-tracker adapter, or `curl`. There is no second, private surface — anything the UI can do, a script can do.

- Base path: `/api` on the Flowdeck origin (e.g. `https://flowdeck.example.com/api`).
- Bodies and responses are JSON, except attachments (`multipart/form-data` up, the image down).
- IDs are UUIDs, timestamps are ISO 8601. Products, tests, templates and flows also have a
  readable **key** (`sign-in-rejects-a-wrong-password`), unique in its scope and never changed
  by a rename; a product's is its **slug** (`relay`), accepted wherever `{product}` appears.
- The full machine-readable contract is [`openapi.json`](openapi.json); the one-line-per-endpoint
  version is [`reference.md`](reference.md).

## If you are a script or an agent: the short path

1. `GET /api` — a one-request orientation: identity, the contract, the routes below.
2. Put `X-Flowdeck-Actor: <your name>` on every request. That is the whole of authentication.
3. `GET /api/products` → pick or `POST` one.
4. `GET /api/products/{product}/suite` — the entire suite as one document, by key, plus its
   `revision`. Edit it. `POST …/suite/plan` says what pushing it would change;
   `PUT …/suite { baseRevision, suite }` applies it in one transaction. Or let the
   [`flowdeck` CLI](cli.md) do this from a folder of files.
5. `GET /api/products/{id}/coverage` — is every test reachable?
6. `POST /api/templates/{id}/runs` → claim, record, `GET /api/runs/{id}/issues`.

Everything else is a per-row edit of the same objects, listed in [`reference.md`](reference.md).
Every list is small enough to return whole — there is no pagination — and every error is
`{ error, details? }` with `details` naming the field by path.

## The model in one minute

```
Product
 ├── Test ─────── TestVersion  (immutable; an edit creates a new version)
 └── Template
      └── Flow
           └── Step ── marks ──▶ Test   (many-to-many)

Run  (a testing day: a frozen snapshot of a template)
 └── FlowRun (one tester working one flow)
      └── TestResult ──▶ pins a TestVersion
```

- A **test** is an assertion — a title and an expected result. It has no steps.
- A **template** is a reusable testing day for one setup. It holds **flows**; each flow is an
  ordered list of **steps** a single tester works through on one or more devices.
- A step **marks** zero or more tests: "when this step is done, these assertions have been
  verified". The same test may be marked by many steps in many flows.
- A **run** instantiates a template. Testers claim flows and record a verdict per marked test.

That is why a suite document has tests beside templates, and steps point at tests by key.

## Identity

Every write is attributed to a name. Flowdeck is a name picker, not an authentication system —
there are no passwords, roles or tokens. A request with no identity is refused with `401`
rather than recorded as "unknown".

There are two ways to carry the name:

| How | Who uses it |
|---|---|
| `X-Flowdeck-Actor: <name>` header on every request | Scripts, `curl`, adapters |
| The `flowdeck_actor` signed cookie set by `PUT /api/me` | The web app |

The header wins when both are present, so a script run from a signed-in machine is still
attributed to the name it chose. Names are trimmed and capped at 60 characters. Reads never
need an identity.

```sh
curl -s https://flowdeck.example.com/api/me -H 'X-Flowdeck-Actor: migration-script'
# {"name":"migration-script"}
```

`PUT /api/me` additionally adds the name to the picker the web app shows. A header-only script
never appears there, which is usually what you want.

## The suite document

A product's whole suite — tests, templates, flows, steps and what each step verifies — as one
JSON document addressed by keys. It is how agents, the CLI and scripts author: read it, edit it,
see what a change would do, push it.

```
GET  /api/products/{product}/suite         → { revision, suite }     (?download=true for a file)
POST /api/products/{product}/suite/plan    suite → { revision, changes, summary, problems }
PUT  /api/products/{product}/suite         { baseRevision, suite, force? } → what changed, the new revision
```

```json
{
  "product": { "name": "Relay", "description": "Team messaging across phones and the web." },
  "tests": [
    { "key": "sending-a-message-shows-it-optimistically",
      "title": "Sending a message shows it optimistically",
      "expect": "The message appears at once with a pending clock, then a single check within 2 seconds.",
      "tags": ["messaging"], "metadata": { "priority": "high" } }
  ],
  "templates": [
    { "key": "monthly-regression", "name": "Monthly regression — fresh install",
      "flows": [
        { "key": "messaging-across-two-devices", "name": "Messaging across two devices",
          "precondition": "Signed in as qa-1 on the Pixel.", "estimateMinutes": 15,
          "steps": [
            { "kind": "action", "text": "Send the message \"hello\".", "device": "Pixel 8" },
            { "kind": "check", "text": "Watch the message as it sends.", "device": "Pixel 8",
              "expect": "It appears at once with a pending clock, then a single check.",
              "verifies": ["sending-a-message-shows-it-optimistically"] }
          ] }
      ] }
  ]
}
```

A complete one is [`examples/suite.json`](examples/suite.json); [`examples/push.sh`](examples/push.sh)
plans and pushes it with `curl`.

Two optional parts are for generated flows ([`cli.md`](cli.md#generated-flows)): `graph`, how
a person moves through the app (`roles`, `screens`, `facts`, `starts`, `actions`), and a test's
`given`, the state it needs (`{ device, at, facts?, also?, look? }`). A push checks them like
the rest: an unknown screen or fact, or a `given` no start can reach, is an error. The order of
roles and starts is kept as written.

**A push replaces the suite**, matching by key:

- a key the product does not have is created;
- an edited test gets a **new version** — the old one, and every result recorded against it,
  keep their wording;
- anything the document **leaves out is archived, never deleted**: history keeps pointing at
  it, and pushing it back restores it. `archived: true` says the same thing explicitly;
- steps have no keys. They are matched by content, so a step that survives an edit keeps its
  id, and a reworded step is an edit rather than a delete and an insert;
- pushing what you pulled changes nothing and keeps the revision. Push is idempotent.

**Plan first.** `POST …/suite/plan` returns each change as data (`changes`) and as a line
(`summary`: `+` created or restored, `~` edited, `-` archived), plus the warnings. It writes
nothing.

**Revisions.** `GET` returns a `revision` (a hash of the suite). `PUT` names it as
`baseRevision`; if the suite has changed since — someone pushed, or edited in the app — the
push is a `409` carrying the current `revision`, and nothing is written. Re-read, re-apply your
change, push again; or send `"force": true` to overwrite. A plan's `revision` is the one it was
made against, so `PUT { baseRevision: plan.revision }` applies exactly what was previewed.

**Rules.** The document is checked before anything is written. Errors are a `400` with each
problem in `details` by path (`["templates", 0, "flows", 2, "steps", 5, "verifies", 0]`):
an invalid or duplicate key, an empty title or `expect`, a step verifying a test that does not
exist. Warnings come back in `problems` and never block: a step that names a second device or
does two things ("Open the chat and send hi"), a check without an `expect`, a test no flow
verifies. [`cli.md`](cli.md) lists them.

Fields:

- `kind` is `action` (something to do) or `check` (something to look at; shows `expect`).
- `device` is free text, one per step. The first step that names a device is where the tester
  is told to pick it up; there is no device registry to create first.
- `after` is optional on either kind: where the step leaves the tester, so they can recover
  when the step itself has gone stale.
- `tags` lift out of the test's `metadata`; anything else in `metadata` is kept as given.

### Creating rows one at a time

The granular routes the web app's editor uses are there for scripts too — useful when a
script produces tests and templates at different times, or adds one thing to a large suite.

```
POST /api/products/{productId}/tests       { "tests": [ {title, expectedResult, metadata?}, … ] }
   → 201, the created tests in request order

POST /api/products/{productId}/templates   { "templates": [ … steps mark by test id … ] }
   → 201, the created templates
```

The first call returns tests in the same order they were sent, which is what lets the script
map its source rows to Flowdeck ids before building the second request. A step in the second
call that marks an id which does not exist fails the whole request.

### Creating, renaming and wiping the product

If the product does not exist yet:

```sh
curl -s -X POST $FLOWDECK/api/products \
  -H 'X-Flowdeck-Actor: migration-script' -H 'content-type: application/json' \
  -d '{"name":"Relay","description":"The messaging app"}'
```

`GET /api/products` lists what is there; `PATCH /api/products/{id}` renames or describes one.
`POST /api/products` takes an optional `slug`; without one it is made from the name.
While a script is still being debugged, `DELETE /api/products/{product}?confirm=true` wipes
the product and everything in it so the next attempt starts clean. Without `confirm=true` it
answers `409` and does nothing.

### Snapshots in the backup bucket

When `BACKUP_REPOSITORY` is set (the same bucket the backup service uses — see
[`backup.md`](backup.md)), a product's suite document can be kept there as a plain JSON object
and brought back later, here or on another instance:

```
POST /api/products/{productId}/suites          save a snapshot → { id, savedAt, savedBy, tests, templates, … }
GET  /api/suites?productId=…                   list, newest first
GET  /api/suites/{suiteId}                     { revision, suite } as saved
POST /api/suites/{suiteId}/restore             { "into": "new", "name"? }  or  { "into": "<product>" }
DELETE /api/suites/{suiteId}
```

`GET /api/suites/status` says whether a bucket is configured; without one the other routes
answer `503`. Restoring over an existing product is a forced push: its suite becomes the
snapshot's, and whatever the snapshot does not have is archived. Nothing here needs restic or
the backup password — snapshots sit beside the encrypted repository as ordinary objects.

### Checking the result

`GET /api/products/{productId}/coverage` is the progress bar for a migration: every live test,
whether some flow somewhere marks it, and which templates do. Start with everything uncovered,
finish when nothing is.

`GET /api/templates/{templateId}/scope` says what one template reaches and which live tests it
misses — a report, not a warning, since a template targeting one setup can only reach the tests
performable in that setup.

## Editing one thing at a time

Everything the editor does is a route, so a script can keep a suite in sync rather than only
seeding it.

**Tests are versioned.** `PATCH /api/tests/{id}` never modifies the stored wording; it creates
a new version and points the test at it. Flows reference the test id, so nothing needs
repointing, and results recorded against an older version keep that version's wording forever.
`GET /api/tests/{id}/versions` lists them. There is no hard delete — `POST /api/tests/{id}/archive`
removes a test from coverage while every historical reference stays intact (`?undo=true`
reverses it).

**Templates, flows and steps** are edited in place:

| To | Call |
|---|---|
| Read one flow with its steps | `GET /api/flows/{id}` |
| Rename, describe or archive a template | `PATCH /api/templates/{id}` |
| Hard-delete a template (only if it never ran) | `DELETE /api/templates/{id}` |
| Add a flow (with its steps) | `POST /api/templates/{id}/flows` |
| Edit a flow's name, precondition or estimate | `PATCH /api/flows/{id}` |
| Archive or restore a flow | `PATCH /api/flows/{id}` `{ "archived": true }` |
| Hard-delete a flow and its steps | `DELETE /api/flows/{id}` |
| Reorder flows | `PUT /api/templates/{id}/flows/order` `{ "ids": [ … ] }` |
| Insert a step at a position | `POST /api/flows/{id}/steps` `{ position, kind, text, … }` |
| Edit a step | `PATCH /api/steps/{id}` |
| Delete a step | `DELETE /api/steps/{id}` |
| Reorder steps | `PUT /api/flows/{id}/steps/order` `{ "ids": [ … ] }` |
| Mark / unmark a test on a step | `PUT` / `DELETE /api/steps/{stepId}/marks/{testId}` |
| Where is this test marked? | `GET /api/tests/{id}/usages` |

Writes on these routes return a `txid` alongside the row. The web app uses it to reconcile its
optimistic state with the live stream; a script can ignore it.

## Running a testing day from a script

The run lifecycle is also plain REST, should an adapter want to drive or observe one.

```
POST /api/templates/{templateId}/runs             start (409 if one is already open; ?force=true)
GET  /api/runs/{runId}                            snapshot, flow runs, every result
POST /api/runs/{runId}/flows/{flowId}/claim       claim a flow (409 lists who else is on it; ?confirm=true)
POST /api/flow-runs/{flowRunId}/results           one verdict for one test on one step
POST /api/flow-runs/{flowRunId}/pass-all          pass every test a step marks
POST /api/flow-runs/{flowRunId}/step-problems     flag a step as wrong (the flow, not the product)
PUT  /api/flow-runs/{flowRunId}/progress          where you are, for the board — provisional, never counted
POST /api/flow-runs/{flowRunId}/finish | abandon
POST /api/runs/{runId}/close                      bookkeeping; ?reopen=true undoes it
DELETE /api/results/{resultId}                    retract a verdict that should not have been recorded
DELETE /api/flow-runs/{flowRunId}/step-problems/{stepId}   withdraw a step report
```

A verdict is `pass`, `fail`, `minor` or `skipped`. `fail` and `skipped` require a `note`;
only `fail` may be `blocking`. Every result carries a client-chosen `idempotencyKey` (8–200
characters) so a retried request records once. Screenshots go to
`POST /api/results/{resultId}/attachments` as `multipart/form-data` with a `file` field.

A step problem is not a verdict: `{ stepId, note, workaround?, blocking? }` says the step is
stale — the button moved, the screen is gone — and whether the tester got past it. Either
`workaround` says how, or `blocking: true` closes the rest of the flow exactly as a blocking
failure does. One per step per flow run; sending it again replaces the earlier report. The tests
the step marks can still be recorded.

## Getting results out

`GET /api/runs/{runId}/issues` is the export. Every non-pass result from the run, each
self-contained — test wording at the version it was run against, flow, step, device, note,
attachments, who and when — so it can become a ticket without a second lookup. The test's
`key` and the flow's `flowKey` (with the run's `templateKey`) name the files in a pulled suite;
`flowdeck report` prints exactly that.

```json
{
  "run": { "id": "…", "date": "…", "product": "Relay", "template": "Monthly regression — fresh install", … },
  "issues": [
    {
      "type": "failure",
      "test": { "id": "…", "key": "emoji-reaction-syncs-across-devices", "versionId": "…", "version": 3, "title": "…", "expected": "…" },
      "context": { "flowId": "…", "flowKey": "messaging-across-two-devices", "flow": "Messaging across two devices", "stepId": "…",
                   "stepNumber": 6, "stepText": "Compare the reaction on both screens.", "device": "Device A" },
      "note": "Count showed 2 on one phone and 1 on the other.",
      "attachments": ["/api/attachments/…"],
      "blocking": false,
      "recordedBy": "Noa",
      "recordedAt": "2026-09-10T11:42:00.000Z"
    }
  ]
}
```

| `type` | From verdict | Typical destination |
|---|---|---|
| `failure` | `fail` | the bug tracker |
| `minor` | `minor` | wherever minors go |
| `invalid_test` | `skipped` | suite maintenance — the test no longer matches the product |
| `pass` | `pass` | only with `?includePass=true` |

Flowdeck labels; the adapter decides. It does not filter, and it does not talk to any tracker
itself.

The feed also carries `stepProblems`: every step a tester flagged as wrong, with the same
`context` block, the `note`, the `workaround` (or `blocking: true`), who and when. They are the
to-do list for whoever maintains the flows, not bugs, and sit beside `issues` rather than in it.

`GET /api/tests/{testId}/history` is the same data pivoted the other way: one test across every
run it appeared in. `GET /api/products/{productId}/runs` lists a product's runs, newest first.

## Errors

| Status | Meaning |
|---|---|
| `400` | The request did not validate. `details` is a list of `{ path, message }` naming each field, so a script fixes its parser rather than guessing. |
| `401` | No identity on a write. Send `X-Flowdeck-Actor`. |
| `404` | No such product / test / template / run. |
| `409` | A suite push whose `baseRevision` is stale (the body carries the current `revision`), a key or slug that is taken, a confirmation is needed, or the action is not allowed right now: a run is already open for this template (`?force=true`), someone else holds this flow (`?confirm=true`), deleting a product (`?confirm=true`), deleting a template that has run (archive it instead), or the step is blocked by an earlier blocking failure. |
| `507` | The attachment disk budget is exhausted. |
| `500` | A bug. The body is `{"error":"internal error"}`; the server log has the rest. |

Every error body has the shape `{ "error": string, "details"?: … }`.

## Using the OpenAPI document

`docs/openapi.json` (and `GET /api/openapi.json` on a live server) is the contract, derived from
the same schemas that validate requests, so it cannot describe something the server does not
enforce. Feed it to any generator — the repository's own `packages/api-client` is
`openapi-typescript` over this file — or open it in Swagger UI / Redoc to browse and try calls.
Set `X-Flowdeck-Actor` as the `actorHeader` security value and every write is attributed.
