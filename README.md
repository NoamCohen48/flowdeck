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

## Develop

```sh
bun install
docker compose up -d --wait postgres electric
bun run db:migrate && bun run db:seed -- --reset   # add --volume for the 300-test product
bun run dev        # API on :8787
bun run dev:web    # Vite on :5173, proxies /api
bun test           # needs the two containers
bun run typecheck
bun run api:generate   # after changing any route: regenerates packages/api-client
```

The OpenAPI document is at `/api/openapi.json`; the parser you write against it uses the
two-phase import in [`.docs/08-api-and-integration.md`](.docs/08-api-and-integration.md).

## Layout

| Path | What |
|---|---|
| `packages/domain` | Dependency-free rules: hand-offs, worst-result, blocking, coverage, palette |
| `apps/server` | Hono API, Drizzle schema, Electric shape proxy, attachments |
| `packages/api-client` | Typed client generated from the OpenAPI document |
| `apps/web` | React app: board, runner, editor, library, dashboards |
| `compose.yaml` | postgres + electric + app + caddy |
