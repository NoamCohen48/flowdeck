<img src="apps/web/public/icon.svg" alt="" width="64" height="64" align="left" />

# Flowdeck

Manual testing as human flows. Tests are assertions; flows are what a person does; a
testing day is a run of a template that seven people work through together, live.
The design lives in [`.docs/`](.docs/00-product-overview.md).

## Run it

From a release, with nothing else to install but Docker:

```sh
curl -fsSL https://github.com/NoamCohen48/flowdeck/releases/latest/download/flowdeck.tar.gz | tar -xz
cd flowdeck && ./start.sh      # creates .env from the defaults, starts everything, prints the address
```

No internet on the server? Each [release](https://github.com/NoamCohen48/flowdeck/releases) also
has `flowdeck-<version>-offline-amd64.tar.gz` (and `-arm64`): one file with every image and the
`flowdeck` CLI for Linux, macOS and Windows inside. Copy it over, unpack, `./start.sh`. Its
`README.md` covers the rest. The images are `ghcr.io/noamcohen48/flowdeck` and `…/flowdeck-backup`;
from a checkout, `docker compose up -d --wait --build` builds them from source instead.

`SEED_DEMO=true` (the default in `.env.example`) loads the fictional Relay product on the
first boot. Set `SITE_ADDRESS` to a real hostname on a server and Caddy fetches a public
certificate. Attachments (and the generated cookie secret) live in the `data` volume; `ATTACHMENTS_BUDGET_MB` caps them.

To upgrade, unpack the next release over the folder (keeping `.env`) and `docker compose up -d
--wait`; migrations run when the app starts.

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

### Release

```sh
scripts/release.sh 0.2.0           # on a clean main: sets the version, regenerates the API docs, commits, tags
git push origin main v0.2.0        # the tag publishes: images, CLI binaries, bundles, the GitHub release
```

CI runs on every PR: typecheck, unit and API tests against real Postgres and Electric, two-browser
end-to-end tests, and the shipped images booted as a whole stack behind Caddy. Every merge to
`main` publishes `:edge` images.

Everything the web app does is also plain REST — see [`docs/`](docs/README.md) for the API
guide, the endpoint reference and the OpenAPI definition.

Suites are written as files, by people or agents, with the CLI ([`docs/cli.md`](docs/cli.md)):

```sh
bun run cli -- guide          # how to write tests and flows
bun run cli -- pull relay     # the suite as files in ./relay; edit, then
bun run cli -- push --plan    # see what would change, and push
```

## Layout

| Path | What |
|---|---|
| `packages/domain` | Dependency-free rules: hand-offs, worst-result, blocking, coverage, palette, suite lint and plan |
| `apps/server` | Hono API, Drizzle schema, Electric shape proxy, attachments |
| `packages/api-client` | Typed client generated from the OpenAPI document |
| `apps/cli` | `flowdeck`: a suite as files — pull, lint, plan, push, report, and the authoring guide |
| `apps/web` | React app: board, runner, editor, library, dashboards |
| `docs` | CLI and API guides, endpoint reference, generated OpenAPI definition, examples |
| `backup` | The backup sidecar: `pg_dump` + the data volume to S3 with restic, and the restore script |
| `site` | The landing page, published to GitHub Pages by `.github/workflows/pages.yml` |
| `scripts` | `release.sh` cuts a release; `bundle.sh` packages one for a host (with `start.sh` and a README), optionally with the images and the CLI |
| `compose.yaml` | postgres + electric + app + caddy + backup |
