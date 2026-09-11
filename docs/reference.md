# Endpoint reference

All paths are under `/api`. Writes need an identity (`X-Flowdeck-Actor` header or the
`flowdeck_actor` cookie); reads do not. Request and response shapes are in
[`openapi.json`](openapi.json); the narrative is in [`api.md`](api.md).

## Identity

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me` | Who this request says it is: `{ name }` or `{ name: null }` |
| `PUT` | `/me` | Pick a name — sets the cookie and adds the name to the picker |
| `GET` | `/actors` | Names seen on this instance, most recent first |
| `PUT` | `/presence` | Heartbeat: "I am looking at `run:…` / `flow:…` / `template:…`" |
| `DELETE` | `/presence` | Leave that scope |

## Products

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/products` | List products |
| `POST` | `/products` | Create a product `{ name, description? }` |
| `GET` | `/products/{productId}` | One product |

## Import

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/products/{productId}/import` | Tests keyed by the caller plus templates marking by key, in one transaction. Returns `{ keys, tests, templates }`. |

## Tests

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/products/{productId}/tests` | The library. `?includeArchived=true` to include archived tests |
| `POST` | `/products/{productId}/tests` | Bulk-create `{ tests: [ { title, expectedResult, metadata? } ] }`; returns them in request order |
| `GET` | `/tests/{testId}` | A test at its current version |
| `PATCH` | `/tests/{testId}` | Edit — creates a new version; `{ title?, expectedResult?, metadata? }` |
| `GET` | `/tests/{testId}/versions` | Every version, oldest first |
| `POST` | `/tests/{testId}/archive` | Archive; `?undo=true` restores. Returns how many steps/flows/templates mark it |
| `GET` | `/tests/{testId}/usages` | Every step that marks this test, with its flow and template |
| `GET` | `/tests/{testId}/history` | One test across every run it appeared in |

## Coverage

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/products/{productId}/coverage` | Per test: covered? needs attention? which templates. Plus totals |
| `GET` | `/templates/{templateId}/scope` | What one template reaches, and the live tests it misses |

## Templates, flows, steps

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/products/{productId}/templates` | Summaries: flow count, marked-test count; archived included |
| `POST` | `/products/{productId}/templates` | Bulk-create `{ templates: [ { name, description?, status?, flows: [ … steps: [ … marks: [testId] ] ] } ] }` |
| `GET` | `/templates/{templateId}` | A template with its flows and steps |
| `PATCH` | `/templates/{templateId}` | `{ name?, description?, status? }` — `archived` leaves the run picker but keeps counting toward coverage |
| `PUT` | `/templates/{templateId}/flows/order` | `{ ids }` — reorder flows |
| `POST` | `/templates/{templateId}/flows` | Add a flow `{ name, precondition?, estimatedMinutes?, steps? }` |
| `PATCH` | `/flows/{flowId}` | `{ name?, precondition?, estimatedMinutes? }` |
| `DELETE` | `/flows/{flowId}` | Delete a flow and its steps |
| `GET` | `/flows/{flowId}/devices` | Devices the flow uses, and the step that introduces each |
| `POST` | `/flows/{flowId}/steps` | Insert `{ position, kind, text, expectedResult?, deviceLabel, marks? }` |
| `PUT` | `/flows/{flowId}/steps/order` | `{ ids }` — reorder steps |
| `PATCH` | `/steps/{stepId}` | `{ kind?, text?, expectedResult?, deviceLabel?, marks? }` — `marks` replaces the set |
| `DELETE` | `/steps/{stepId}` | Delete a step |
| `PUT` | `/steps/{stepId}/marks/{testId}` | Mark a test on a step |
| `DELETE` | `/steps/{stepId}/marks/{testId}` | Unmark |

## Runs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/products/{productId}/runs` | A product's runs, newest first |
| `POST` | `/templates/{templateId}/runs` | Start a testing day (snapshots the template). `409` if one is open; `?force=true` |
| `GET` | `/runs/{runId}` | Snapshot, flow runs, every result |
| `POST` | `/runs/{runId}/close` | Close; `?reopen=true` undoes it |
| `GET` | `/runs/{runId}/issues` | The issue feed. `?includePass=true` for everything |
| `POST` | `/runs/{runId}/flows/{flowId}/claim` | Claim a flow. `409` lists who else holds it; `?confirm=true` runs alongside |
| `POST` | `/flow-runs/{flowRunId}/results` | `{ stepId, testId, verdict, note?, blocking?, idempotencyKey }` |
| `POST` | `/flow-runs/{flowRunId}/pass-all` | `{ stepId, idempotencyKeyPrefix }` — pass every test the step marks |
| `POST` | `/flow-runs/{flowRunId}/finish` | Finish |
| `POST` | `/flow-runs/{flowRunId}/abandon` | Abandon — the next person starts from step 1 |

## Attachments

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/results/{resultId}/attachments` | `multipart/form-data`, field `file` (an image) |
| `GET` | `/results/{resultId}/attachments` | Attachments on a result |
| `GET` | `/attachments/{id}` | The bytes |
| `GET` | `/attachments/usage` | Disk used against the budget |

## Meta

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/openapi.json` | This contract, generated live |
| `GET` | `/health` | *(not under `/api`)* Database reachability |
