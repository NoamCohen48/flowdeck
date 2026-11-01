#!/bin/sh
# Start Flowdeck from this folder. Safe to run again: it only loads images that
# are missing, keeps an existing .env, and leaves running services alone.
set -eu
cd "$(dirname "$0")"

if ! docker compose version > /dev/null 2>&1; then
  echo "Flowdeck needs Docker with the compose plugin: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

# The offline bundle carries its images; load them once, the first time.
if [ -f images.tar ]; then
  for image in $(docker compose config --images); do
    if ! docker image inspect "$image" > /dev/null 2>&1; then
      echo "Loading the images (once, about a minute)..."
      docker load -i images.tar > /dev/null
      break
    fi
  done
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env with the defaults. Edit it later to set your hostname and passwords."
fi

echo "Starting Flowdeck..."
docker compose up -d --wait

site="$(sed -n 's/^SITE_ADDRESS=//p' .env | tail -n 1)"
port="$(sed -n 's/^HTTPS_PORT=//p' .env | tail -n 1)"
[ -n "$port" ] && [ "$port" != 443 ] && site="${site:-localhost}:$port"
echo
echo "Flowdeck is running: https://${site:-localhost}"
