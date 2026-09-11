#!/bin/sh
# Migrate, seed the demo once if asked, then serve.
set -e
cd /app/apps/server

# The identity cookie needs a signing secret. If none is configured, generate one
# on first boot and keep it on the data volume, so nobody is signed out on restart
# and nobody has to run openssl before seeing the app.
if [ -z "${COOKIE_SECRET:-}" ]; then
  SECRET_FILE="${COOKIE_SECRET_FILE:-/data/cookie-secret}"
  if [ ! -s "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
    echo "generated a cookie secret at $SECRET_FILE"
  fi
  COOKIE_SECRET="$(cat "$SECRET_FILE")"
  export COOKIE_SECRET
fi

bun src/db/migrate.ts
if [ "${SEED_DEMO:-}" = "true" ]; then
  bun src/db/seed.ts --if-empty
fi
exec bun src/index.ts
