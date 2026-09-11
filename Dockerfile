# Flowdeck: the API and the built frontend in one image, served by Bun.
# Migrations run at start, so a fresh volume comes up ready.
FROM oven/bun:1.3-alpine AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --cwd apps/web build

FROM oven/bun:1.3-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./
COPY --from=build /src/packages ./packages
COPY --from=build /src/apps/server ./apps/server
COPY --from=build /src/apps/web/dist ./apps/web/dist
ENV WEB_DIST=/app/apps/web/dist
ENV ATTACHMENTS_DIR=/data/attachments
ENV PORT=8787
EXPOSE 8787
WORKDIR /app/apps/server
COPY docker-entrypoint.sh /usr/local/bin/flowdeck
RUN chmod +x /usr/local/bin/flowdeck
CMD ["flowdeck"]
