# The Flowdeck API

Flowdeck exposes one REST API. The web app uses it; so does an import script, an issue-tracker
adapter, or `curl`. There is no second, private surface — anything the UI can do, a script can do.

- Base path: `/api` on the Flowdeck origin (e.g. `https://flowdeck.example.com/api`).
- Bodies and responses are JSON, except attachments (`multipart/form-data` up, the image down).
- IDs are UUIDs, timestamps are ISO 8601.
- The full machine-readable contract is [`openapi.json`](openapi.json); the one-line-per-endpoint
  version is [`reference.md`](reference.md).

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

That is why the import is shaped the way it is: tests first (or keyed), then templates whose
steps point at them.

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

## Importing a suite

There are two ways to load tests, templates, flows and steps. Both create everything in one
transaction; both are **not idempotent** — running the same import twice creates everything
twice. During a migration the practical answer is to wipe the product and re-import while the
parser is still being debugged.

### One request: the bundle

`POST /api/products/{productId}/import`

Give every test a `key` of your choosing (the spreadsheet row, the Jira issue, anything unique
within the bundle) and have steps mark tests by that key. Flowdeck resolves the keys server-side
and returns the mapping.

```json
{
  "tests": [
    { "key": "T-10", "title": "Sending a message shows it optimistically",
      "expectedResult": "Appears immediately with a pending clock icon",
      "metadata": { "priority": "high", "tags": ["messaging"] } },
    { "key": "T-11", "title": "Emoji reaction syncs across devices",
      "expectedResult": "The reaction and its count are identical on both devices." }
  ],
  "templates": [
    {
      "name": "Monthly regression — fresh install",
      "description": "Two phones, clean install, QA account.",
      "flows": [
        {
          "name": "Messaging across two devices",
          "precondition": "Relay installed on both phones, signed in as qa-1 and qa-2.",
          "estimatedMinutes": 25,
          "steps": [
            { "kind": "action",    "text": "On Device A, open the chat with qa-2.", "deviceLabel": "Device A" },
            { "kind": "action",    "text": "Send the message 'hello'.", "deviceLabel": "Device A" },
            { "kind": "assertion", "text": "The message appears in the thread.",
              "expectedResult": "Immediately, with a pending clock icon.", "deviceLabel": "Device A",
              "marks": ["T-10"] },
            { "kind": "action",    "text": "Pick up Device B and open the same chat.", "deviceLabel": "Device B" },
            { "kind": "action",    "text": "React to 'hello' with 👍.", "deviceLabel": "Device B" },
            { "kind": "assertion", "text": "Compare the reaction on both screens.",
              "expectedResult": "Same emoji, same count, on both.", "deviceLabel": "Device A",
              "marks": ["T-11"] }
          ]
        }
      ]
    }
  ]
}
```

Response, `201`:

```json
{
  "keys": { "T-10": "5c0e…", "T-11": "9a41…" },
  "tests": [ { "id": "5c0e…", "productId": "…", "archived": false, "current": { … } }, … ],
  "templates": [ { "id": "…", "name": "Monthly regression — fresh install", "flows": [ … ] } ]
}
```

Rules:

- A mark is either a `key` declared in the same bundle or the `id` of a test that already exists
  in the product. Anything else is a `400` whose `details` name the offending mark by path
  (`templates[0].flows[0].steps[5].marks[0]`), and nothing is created.
- Keys must be unique within the bundle. Up to 1000 tests and 200 templates per request.
- Either half may be empty — a bundle of only tests, or only templates marking existing ids,
  is fine. An empty bundle is a `400`.
- `deviceLabel` is free text. The first step to use a label is where the tester is told to pick
  that device up; there is no device registry to create first.
- `expectedResult` is shown for `assertion` steps and may be `null` for `action` steps.
- `postState` is optional on either kind: where the tester should be once the step is done
  ("back on the channel list, the new message at the bottom"). It is what a tester improvises
  toward when the step itself has gone stale.

A complete example lives in [`examples/import-bundle.json`](examples/import-bundle.json), with
[`examples/import.sh`](examples/import.sh) to send it.

### Two requests: tests, then templates

The original contract, for a script that wants to hold the mapping itself or that produces
tests and templates at different times.

```
POST /api/products/{productId}/tests       { "tests": [ {title, expectedResult, metadata?}, … ] }
   → 201, the created tests in request order

POST /api/products/{productId}/templates   { "templates": [ … steps mark by test id … ] }
   → 201, the created templates
```

The first call returns tests in the same order they were sent, which is what lets the script
map its source rows to Flowdeck ids before building the second request. A step in the second
call that marks an id which does not exist fails the whole request.

### Creating the product

If the product does not exist yet:

```sh
curl -s -X POST $FLOWDECK/api/products \
  -H 'X-Flowdeck-Actor: migration-script' -H 'content-type: application/json' \
  -d '{"name":"Relay","description":"The messaging app"}'
```

`GET /api/products` lists what is there.

### Checking the result

`GET /api/products/{productId}/coverage` is the progress bar for a migration: every live test,
whether some flow somewhere marks it, and which templates do. Start with everything uncovered,
finish when nothing is.

`GET /api/templates/{templateId}/scope` says what one template reaches and which live tests it
misses — a report, not a warning, since a template targeting one setup can only reach the tests
performable in that setup.

## Editing after import

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
| Rename, describe or archive a template | `PATCH /api/templates/{id}` |
| Add a flow (with its steps) | `POST /api/templates/{id}/flows` |
| Edit a flow's name, precondition or estimate | `PATCH /api/flows/{id}` |
| Delete a flow and its steps | `DELETE /api/flows/{id}` |
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
POST /api/flow-runs/{flowRunId}/finish | abandon
POST /api/runs/{runId}/close                      bookkeeping; ?reopen=true undoes it
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
attachments, who and when — so it can become a ticket without a second lookup.

```json
{
  "run": { "id": "…", "date": "…", "product": "Relay", "template": "Monthly regression — fresh install", … },
  "issues": [
    {
      "type": "failure",
      "test": { "id": "…", "versionId": "…", "version": 3, "title": "…", "expected": "…" },
      "context": { "flowId": "…", "flow": "Messaging across two devices", "stepId": "…",
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
| `409` | A confirmation is needed, or the action is not allowed right now: a run is already open for this template (`?force=true`), someone else holds this flow (`?confirm=true`), or the step is blocked by an earlier blocking failure. |
| `507` | The attachment disk budget is exhausted. |
| `500` | A bug. The body is `{"error":"internal error"}`; the server log has the rest. |

Every error body has the shape `{ "error": string, "details"?: … }`.

## Using the OpenAPI document

`docs/openapi.json` (and `GET /api/openapi.json` on a live server) is the contract, derived from
the same schemas that validate requests, so it cannot describe something the server does not
enforce. Feed it to any generator — the repository's own `packages/api-client` is
`openapi-typescript` over this file — or open it in Swagger UI / Redoc to browse and try calls.
Set `X-Flowdeck-Actor` as the `actorHeader` security value and every write is attributed.
