#!/bin/sh
# Package a release for a host: the compose file, the Caddyfile, the env
# template, a README and start.sh, pinned to one version. With --offline the
# bundle also carries every image the stack runs and the CLI for each OS, so a
# host that cannot reach a registry (or GitHub) needs nothing else.
#
#   scripts/bundle.sh 0.2.0                 dist/flowdeck-0.2.0.tar.gz
#   scripts/bundle.sh --offline 0.2.0       dist/flowdeck-0.2.0-offline-amd64.tar.gz
#   PLATFORM=linux/arm64 scripts/bundle.sh --offline 0.2.0
#
# --offline pulls the published images, so the version must already be released
# (or the images built locally under the same names). The CLI binaries are taken
# from CLI_DIR (default apps/cli/release, where the release workflow puts them).
set -eu

offline=false
if [ "${1:-}" = "--offline" ]; then offline=true; shift; fi
version="${1:?usage: scripts/bundle.sh [--offline] <version> [out-dir]}"
out="${2:-dist}"
platform="${PLATFORM:-linux/amd64}"
arch="${platform#linux/}"

root="$(cd "$(dirname "$0")/.." && pwd)"
cli_dir="${CLI_DIR:-$root/apps/cli/release}"
name="flowdeck-$version"
[ "$offline" = true ] && name="$name-offline-$arch"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
dir="$stage/flowdeck"
mkdir -p "$dir/backup/ca" "$root/$out"

# The bundle pins its own release: FLOWDECK_VERSION still overrides it.
sed "s/\${FLOWDECK_VERSION:-latest}/\${FLOWDECK_VERSION:-$version}/" "$root/compose.yaml" > "$dir/compose.yaml"
cp "$root/Caddyfile" "$root/.env.example" "$dir/"
cp "$root/scripts/bundle-start.sh" "$dir/start.sh"
chmod +x "$dir/start.sh"
touch "$dir/backup/ca/.gitkeep"

if [ "$offline" = true ]; then
  images="$(cd "$dir" && docker compose config --images | sort -u)"
  # LOCAL_IMAGES=1 packs what is already here (a test before anything is published).
  for image in $images; do
    if [ "${LOCAL_IMAGES:-}" = 1 ] && docker image inspect "$image" > /dev/null 2>&1; then continue; fi
    docker pull --quiet --platform "$platform" "$image" > /dev/null
  done
  # shellcheck disable=SC2086
  docker save -o "$dir/images.tar" $images
  if ls "$cli_dir"/flowdeck-* > /dev/null 2>&1; then
    mkdir -p "$dir/cli"
    cp "$cli_dir"/flowdeck-* "$dir/cli/"
  else
    echo "no CLI binaries in $cli_dir; the bundle goes without them" >&2
  fi
fi

sed "s/{{VERSION}}/$version/g" "$root/scripts/bundle-README.md" > "$dir/README.md"

tar -C "$stage" -czf "$root/$out/$name.tar.gz" flowdeck
echo "$out/$name.tar.gz"
