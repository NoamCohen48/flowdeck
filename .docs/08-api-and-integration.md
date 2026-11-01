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

## Authoring: the suite as files

A suite is mostly writing — tests and long flows — so it is written as files, by people or by
agents, and landed as one reviewed change (D43).

```
flowdeck pull relay        →  relay/tests/*.yaml, relay/templates/<t>/<f>.flow.yaml, AGENTS.md
flowdeck lint              →  the rules, offline: one device per step, one thing per step, …
flowdeck push --plan       →  + created  ~ edited  - archived; nothing written
flowdeck push              →  one transaction, refused if the suite moved on since the pull
```

Underneath is one document per product, addressed by readable keys rather than ids. Migrating from
Confluence, Jira or a spreadsheet is the same path: a script (or an agent) writes the document or the
files, plans, pushes — and can push again after fixing its parser, because a push of the same thing
changes nothing.

Writes are attributed: a script sends `X-Flowdeck-Actor: <name>` (D38). The coverage endpoint doubles
as a migration progress bar — start with everything uncovered, finish when nothing is.

Routes, the CLI, examples and the OpenAPI file: [`docs/`](../docs/README.md).
