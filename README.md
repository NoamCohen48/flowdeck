<img src="apps/web/public/icon.svg" alt="" width="64" height="64" align="left" />

# Flowdeck

Manual testing as human flows. Tests are assertions; flows are what a person does; a
testing day is a run of a template that seven people work through together, live.
The design lives in [`.docs/`](.docs/00-product-overview.md).

## Run it

```sh
cp .env.example .env          # defaults are fine for a first run
docker compose up -d --wait
open https://localhost         # Caddy's own certificate on localhost; trust it or click through
```

`SEED_DEMO=true` (the default in `.env.example`) loads the fictional Relay product on the
first boot. Set `SITE_ADDRESS` to a real hostname on a server and Caddy fetches a public
certificate. Attachments (and the generated cookie secret) live in the `data` volume; `ATTACHMENTS_BUDGET_MB` caps them.

## Back up and restore

Set `BACKUP_REPOSITORY` in `.env` to the S3 inside your network (plus a `BACKUP_PASSWORD`
that encrypts everything before it leaves the host) and the `backup` service snapshots the
database and every attachment on start and then every `BACKUP_INTERVAL`. Keep that password
somewhere other than this host.

If the host is gone, on a new machine with the same `.env`:

```sh
docker compose up -d --wait postgres                    # only Postgres, nothing that writes
docker compose run --rm backup flowdeck-restore latest  # --list to pick an older snapshot
docker compose up -d --wait
```

To undo a bad change on a running install: `docker compose stop app electric`, the same
restore via `docker compose exec backup …`, then `docker compose up -d --force-recreate
electric app`. The full story is in [`docs/backup.md`](docs/backup.md).

## Develop

```sh
bun install
docker compose up -d --wait postgres electric
bun run db:migrate && bun run db:seed -- --reset   # add --volume for the 300-test product
bun run dev        # API on :8787
bun run dev:web    # Vite on :5173, proxies /api
bun run test:setup # once: a flowdeck_test database and its own Electric, so tests never touch dev data
bun test
bun run typecheck
bun run docs:api       # after changing any route: regenerates packages/api-client and docs/openapi.json
```

Everything the web app does is also plain REST — see [`docs/`](docs/README.md) for the API
guide, the endpoint reference and the OpenAPI definition. A script identifies itself with an
`X-Flowdeck-Actor` header and loads a whole suite with `POST /api/products/{id}/import`.

## Layout

| Path | What |
|---|---|
| `packages/domain` | Dependency-free rules: hand-offs, worst-result, blocking, coverage, palette |
| `apps/server` | Hono API, Drizzle schema, Electric shape proxy, attachments |
| `packages/api-client` | Typed client generated from the OpenAPI document |
| `apps/web` | React app: board, runner, editor, library, dashboards |
| `docs` | API guide, endpoint reference, generated OpenAPI definition, import examples |
| `backup` | The backup sidecar: `pg_dump` + the data volume to S3 with restic, and the restore script |
| `compose.yaml` | postgres + electric + app + caddy + backup |
