# Flowdeck docs

Everything an agent, a script or an integration needs to write a suite into Flowdeck and get
results back out, without touching the web app.

| File | What |
|---|---|
| [`cli.md`](cli.md) | The `flowdeck` CLI: a suite as files — pull, lint, plan, push, report — and the rules for writing tests and flows |
| [`api.md`](api.md) | The API guide: identity, the suite document, editing, running a testing day, exporting issues, errors |
| [`reference.md`](reference.md) | Every endpoint, one line each, grouped by resource |
| [`openapi.json`](openapi.json) | The OpenAPI 3.1 definition — generated from the server's own request schemas, never hand-edited |
| [`examples/`](examples/) | A small suite as files (`relay/`) and as one document (`suite.json`), and a curl script that pushes it |
| [`backup.md`](backup.md) | Off-host backups to your network's S3, and how to restore — on a fresh machine or over a running one |

The live server serves the same definition at `GET /api/openapi.json`. Regenerate the copy
here after changing any route:

```sh
bun run docs:api
```

CI fails if the checked-in copy is stale, the same way it does for the generated client in
`packages/api-client`.

Product design and the reasoning behind the model live in [`.docs/`](../.docs/00-product-overview.md);
this folder is the how-to.
