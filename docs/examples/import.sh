#!/usr/bin/env sh
# Load examples/import-bundle.json into a Flowdeck product.
#
#   FLOWDECK=https://localhost ACTOR=migration-script ./import.sh [productId]
#
# Without a productId, a product called "Relay (import example)" is created first.
# -k is only there for Caddy's self-signed localhost certificate; drop it for a real host.
set -eu

FLOWDECK="${FLOWDECK:-https://localhost}"
ACTOR="${ACTOR:-import-script}"
HERE="$(cd "$(dirname "$0")" && pwd)"

api() {
  curl -ksS -H "X-Flowdeck-Actor: $ACTOR" -H 'content-type: application/json' "$@"
}

PRODUCT="${1:-}"
if [ -z "$PRODUCT" ]; then
  PRODUCT=$(api -X POST "$FLOWDECK/api/products" \
    -d '{"name":"Relay (import example)","description":"Created by docs/examples/import.sh"}' \
    | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  echo "created product $PRODUCT"
fi

echo "importing bundle into $PRODUCT as $ACTOR"
api -X POST "$FLOWDECK/api/products/$PRODUCT/import" --data-binary "@$HERE/import-bundle.json"
echo
echo "coverage:"
api "$FLOWDECK/api/products/$PRODUCT/coverage"
echo
