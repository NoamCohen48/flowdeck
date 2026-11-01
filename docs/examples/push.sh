#!/usr/bin/env sh
# Push examples/suite.json to a Flowdeck product with nothing but curl.
# (The flowdeck CLI does this, and more, from a folder of files: see docs/cli.md.)
#
#   FLOWDECK=https://localhost ACTOR=suite-script ./push.sh [product-slug]
#
# Without a slug, a product "relay-example" is created first.
# -k is only there for Caddy's self-signed localhost certificate; drop it for a real host.
set -eu

FLOWDECK="${FLOWDECK:-https://localhost}"
ACTOR="${ACTOR:-suite-script}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PRODUCT="${1:-relay-example}"

api() {
  curl -ksS -H "X-Flowdeck-Actor: $ACTOR" -H 'content-type: application/json' "$@"
}

if [ -z "${1:-}" ]; then
  api -X POST "$FLOWDECK/api/products" -d '{"name":"Relay (example)","slug":"relay-example"}' >/dev/null || true
fi

# A push names the revision it was made from, so it cannot silently undo someone else's edit.
REVISION=$(api "$FLOWDECK/api/products/$PRODUCT/suite" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')

echo "plan:"
api -X POST "$FLOWDECK/api/products/$PRODUCT/suite/plan" --data-binary "@$HERE/suite.json"
echo
echo "push (base $REVISION):"
printf '{"baseRevision":"%s","suite":%s}' "$REVISION" "$(cat "$HERE/suite.json")" \
  | api -X PUT "$FLOWDECK/api/products/$PRODUCT/suite" --data-binary @-
echo
