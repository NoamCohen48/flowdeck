# Flowdeck docs

Everything a script or an integration needs to load content into Flowdeck and get results
back out, without touching the web app.

| File | What |
|---|---|
| [`api.md`](api.md) | The API guide: identity, importing tests and templates, editing, running a testing day, exporting issues, errors |
| [`reference.md`](reference.md) | Every endpoint, one line each, grouped by resource |
| [`openapi.json`](openapi.json) | The OpenAPI 3.1 definition — generated from the server's own request schemas, never hand-edited |
| [`examples/`](examples/) | A sample import bundle and a curl script that loads it |

The live server serves the same definition at `GET /api/openapi.json`. Regenerate the copy
here after changing any route:

```sh
bun run docs:api
```

CI fails if the checked-in copy is stale, the same way it does for the generated client in
`packages/api-client`.

Product design and the reasoning behind the model live in [`.docs/`](../.docs/00-product-overview.md);
this folder is the how-to.
