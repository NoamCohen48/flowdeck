#!/bin/sh
# Cut a release: set the version, regenerate what carries it, commit, tag.
# Pushing the tag is what publishes (.github/workflows/release.yml), so this
# stops short of it and prints the command.
#
#   scripts/release.sh 0.2.0
#   scripts/release.sh 0.2.0-rc.1      a prerelease: images get no :latest
set -eu

version="${1:?usage: scripts/release.sh <version>   (e.g. 0.2.0)}"
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' \
  || { echo "not a version: $version" >&2; exit 2; }

cd "$(dirname "$0")/.."
[ "$(git branch --show-current)" = main ] || { echo "release from main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "the working tree has changes; commit or stash them" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" > /dev/null && { echo "v$version already exists" >&2; exit 1; }

# package.json is the one place the version lives; the server, the CLI and the
# OpenAPI document all read it.
bun -e '
  const path = "package.json";
  const pkg = await Bun.file(path).json();
  pkg.version = process.argv[1];
  await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
' "$version"
bun run docs:api > /dev/null

git add package.json packages/api-client docs/openapi.json
git commit -q -m "Release v$version"
git tag -a "v$version" -m "Flowdeck $version"
echo "tagged v$version. To publish: git push origin main v$version"
