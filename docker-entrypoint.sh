#!/bin/sh
# Migrate, seed the demo once if asked, then serve.
set -e
cd /app/apps/server
bun src/db/migrate.ts
if [ "${SEED_DEMO:-}" = "true" ]; then
  bun src/db/seed.ts --if-empty
fi
exec bun src/index.ts
