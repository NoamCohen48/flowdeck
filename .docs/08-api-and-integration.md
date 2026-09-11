# API and Integration

*Flowdeck emits structured data and accepts structured data. It integrates with nothing directly.*

---

## Principle

Flowdeck does not talk to Jira, Confluence, or any tracker. It exposes an API; adapters written
outside it decide what to do with the data.

Two reasons. Per-tracker integration is a large amount of work for a seven-person team and breaks
whenever the tracker changes. And an export is a file you can inspect before anything leaves the
system, which matters when the product under test is classified.

---

## Export: the issue feed

`GET /api/runs/{runId}/issues`

Returns every non-pass result from a run. Each issue is self-contained — enough context to become a
ticket without a second lookup.

```json
{
  "run": {
    "id": "run-2026-09",
    "date": "2026-09-10",
    "product": "Relay",
    "template": "Monthly regression — fresh install"
  },
  "issues": [
    {
      "type": "failure",
      "test": {
        "id": "T-10",
        "versionId": "T-10-v1",
        "title": "Emoji reaction syncs across devices",
        "expected": "The reaction and its count are identical on both devices."
      },
      "context": {
        "flow": "Messaging across two devices",
        "stepNumber": 8,
        "stepText": "Compare the reaction on both screens.",
        "device": "Pixel 8"
      },
      "note": "Reaction count showed 2 on the iPhone and 1 on the Pixel.",
      "attachments": ["/api/attachments/a91f.png"],
      "blocking": false,
      "recordedBy": "Noa",
      "recordedAt": "2026-09-10T11:42:00+03:00"
    }
  ]
}
```

### Flowdeck labels, the adapter decides

Every non-pass result appears in the feed, typed:

| `type` | Source verdict |
|---|---|
| `failure` | Fail |
| `minor` | Minor issue |
| `invalid_test` | Skipped — the test is wrong |

Flowdeck does not filter. It does not decide that a minor issue is unworthy of a ticket or that an
invalid test belongs somewhere other than Jira. The adapter routes: failures to the bug tracker,
invalid tests to suite maintenance, minors wherever they belong. Changing that policy means editing
the adapter, not Flowdeck.

Pass results are available through the same endpoint with a filter, for anyone wanting the full
day's data rather than only the problems.

### In-app copy-out

The run report also offers a "copy as ticket" action producing the same context as formatted text,
for filing one bug by hand without running anything.

---

## Import: creating content

The import path exists so a script can parse an existing suite — Confluence, Jira, a spreadsheet —
and load it in. Flowdeck does not care about the source.

### Two-phase, using returned IDs

```
POST /api/products/{id}/tests        → returns created tests with their IDs
POST /api/products/{id}/templates    → templates, flows and steps;
                                       steps reference tests by the IDs from phase one
```

The importing script creates tests first, holds the mapping from source row to Flowdeck test ID, and
then creates templates whose steps mark those IDs.

**Known tradeoff:** this is not idempotent. Running the parser twice creates every test twice, and
Flowdeck cannot tell they are the same. In practice the fix during migration is to wipe and
re-import while the parser is still wrong. If that becomes painful, an optional `externalId` field
on tests would make re-import safe — it can be added later without breaking existing callers, since
it is optional on create.

### One-phase, using caller keys

`POST /api/products/{id}/import` folds the two phases into one transaction: each test carries a
caller-chosen `key`, steps mark by key (or by the id of an existing test), and the response returns
the key → id mapping. Same non-idempotency, one fewer thing for the script to hold. The two-phase
contract stays for scripts that produce tests and templates at different times.

### Identity for scripts

Writes are attributed. A script has no cookie jar, so it sends `X-Flowdeck-Actor: <name>` on every
request instead of `PUT /api/me`; the header wins over the cookie when both are present. Still a
name picker, not authentication (D38).

The how-to for all of this — guide, endpoint reference, generated OpenAPI file, examples — is in
[`docs/`](../docs/README.md).

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/products/{id}/import` | Tests and templates together, keyed, one transaction |
| `POST` | `/api/products/{id}/tests` | Bulk-create tests |
| `PATCH` | `/api/tests/{id}` | Edit — creates a new version |
| `POST` | `/api/tests/{id}/archive` | Archive |
| `POST` | `/api/products/{id}/templates` | Bulk-create templates with flows and steps |
| `GET` | `/api/products/{id}/coverage` | Coverage state per test |
| `POST` | `/api/templates/{id}/runs` | Start a testing day |
| `GET` | `/api/runs/{id}` | Full run state |
| `GET` | `/api/runs/{id}/issues` | The issue feed above |

The coverage endpoint is worth having beyond the UI: during a migration it is a progress bar —
start with everything uncovered, finish when nothing is.
