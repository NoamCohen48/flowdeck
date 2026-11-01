# The backup sidecar: pg_dump from the same major version as the database it
# dumps, plus restic to ship the dump and the attachments off the host.
FROM postgres:18-alpine
RUN apk add --no-cache restic
COPY flowdeck-backup flowdeck-restore /usr/local/bin/
RUN chmod +x /usr/local/bin/flowdeck-backup /usr/local/bin/flowdeck-restore
CMD ["sh", "-c", "exec flowdeck-backup --every \"$BACKUP_INTERVAL\""]
