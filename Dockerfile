# Flowdeck: the API and the built frontend in one image, served by Bun.
# Migrations run at start, so a fresh volume comes up ready.
#
#   docker build -t flowdeck --build-arg VERSION=0.1.0 --build-arg REVISION=$(git rev-parse HEAD) .
ARG BUN_IMAGE=oven/bun:1.3.11-alpine

# The workspace manifests alone, so the dependency layers are cached until a
# package.json or the lockfile changes, not on every source edit.
FROM ${BUN_IMAGE} AS manifests
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/

FROM manifests AS web
RUN bun install --frozen-lockfile
COPY packages packages
COPY apps/web apps/web
RUN bun run --cwd apps/web build

# What the server needs at runtime and nothing else: no Vite, no Playwright,
# no TypeScript. A tenth of the full install.
FROM manifests AS deps
RUN bun install --frozen-lockfile --production --filter @flowdeck/server

FROM ${BUN_IMAGE}
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Flowdeck" \
      org.opencontainers.image.description="Manual testing as human flows: the API and the web app" \
      org.opencontainers.image.source="https://github.com/NoamCohen48/flowdeck" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist \
    ATTACHMENTS_DIR=/data/attachments \
    PORT=8787
COPY --from=deps /src ./
COPY packages/domain/src packages/domain/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY --from=web /src/apps/web/dist apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/flowdeck

# Not root. /data is created here, owned by bun, so a fresh named volume
# mounted over it inherits that ownership.
RUN chmod 755 /usr/local/bin/flowdeck && mkdir -p /data/attachments && chown -R bun:bun /data
USER bun
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:8787/health > /dev/null || exit 1
WORKDIR /app/apps/server
CMD ["flowdeck"]
