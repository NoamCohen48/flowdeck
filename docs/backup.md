# Backup and restore

Everything Flowdeck knows lives in two places on the host: the Postgres database (tests,
flows, templates, runs, results) and the `data` volume (attachment files, plus the cookie
secret). Both are lost together if the host is, so the `backup` service in `compose.yaml`
copies both to an S3 bucket — the one inside your own network, never a public cloud — on a
schedule, encrypted before they leave the host.

It uses [restic](https://restic.net): client-side encryption, deduplication (attachments
never change once written, so each is uploaded exactly once), and a retention policy.

## Turn it on

In `.env`:

```sh
BACKUP_REPOSITORY=s3:https://s3.internal.example/flowdeck-backups
BACKUP_PASSWORD=<openssl rand -hex 32>
BACKUP_S3_ACCESS_KEY=…
BACKUP_S3_SECRET_KEY=…
BACKUP_INTERVAL=24h          # 12h, 6h, 30m — a snapshot on start, then one every interval
BACKUP_KEEP=--keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 12
```

(`--keep-last 3` is there so one bad snapshot never prunes the last good one; the rest is
calendar retention as restic's `forget` understands it.)

then `docker compose up -d`. The service takes a snapshot immediately and then on the
interval; `docker compose logs backup` shows each one. With `BACKUP_REPOSITORY` empty the
service idles with a notice, so the rest of the stack is unaffected.

**`BACKUP_PASSWORD` is the encryption key.** Without it the bucket is noise. Keep it
somewhere that is not this host — a password manager, the same place the S3 credentials
live — because the day you need it is the day the host is gone.

Details that come up with an in-house S3:

- **Bucket.** Either create `flowdeck-backups` beforehand or give the key permission to
  create it; the first run initialises the repository inside it.
- **Internal CA.** If the endpoint is `https` with a certificate signed by your own
  authority, drop that authority's certificate (`.pem` or `.crt`) into `backup/ca/`. The
  directory is mounted into the service and picked up automatically.
- **Path-style addressing.** MinIO, Ceph and most on-prem stores want it; restic detects
  this from the endpoint, so nothing to configure.
- **Deletion protection.** Retention (`BACKUP_KEEP`) means the service can delete old
  snapshots, which means a compromised host could delete them all. Bucket versioning or
  object lock on the S3 side makes that recoverable and costs nothing here.

A few recent dumps also stay on the host in the `backups` volume (`BACKUP_LOCAL_KEEP`, default 3),
for undoing a bad change without a round-trip — they are a convenience, not the backup.

## Restore

The restore replaces everything: the database is dropped and re-created from the dump, and
the attachments are overwritten with the snapshot's copy. It needs only the repository
settings and Postgres, so it works the same on a fresh machine and on a broken one.

### After the host died

On the new machine, with the repository and `.env` (including `BACKUP_PASSWORD`) in hand:

```sh
git clone … flowdeck && cd flowdeck
cp /somewhere/safe/.env .env                 # or recreate it; the BACKUP_* values must match
docker compose up -d --wait postgres         # only Postgres, nothing that writes yet
docker compose run --rm backup flowdeck-restore latest
docker compose up -d --wait                  # everything else
```

`flowdeck-restore --list` shows every snapshot; pass an id instead of `latest` to go back
further. The script prints the snapshot it is about to load and asks for confirmation
(`--yes` skips that, for scripts).

Do not `docker compose up -d` the whole stack *before* restoring: the app would migrate and
possibly seed an empty database, and the backup service would happily snapshot it. (It
refuses to snapshot a database with no tables at all, which covers the plain case, but not
a seeded one.)

### Undoing a bad change on a running install

```sh
docker compose stop app electric
docker compose exec backup flowdeck-restore latest      # or an id from --list
docker compose up -d --force-recreate electric app
```

`--force-recreate electric` matters: Electric caches shape logs from the old database, and
the restored one has a different history. The restore drops Electric's replication slot for
the same reason; a recreated Electric makes a fresh one.

### Just the database, from a local dump

For a mistake made minutes ago, the dumps kept on the host are quicker than the repository
and leave the attachments alone:

```sh
docker compose exec backup ls -l /backups/history
docker compose stop app electric
docker compose exec backup flowdeck-restore --local latest    # or a file name from the listing
docker compose up -d --force-recreate electric app
```

A scheduled backup and a restore never overlap: they share a lock, so whichever starts
second waits for the first to finish.

## Suite snapshots

The restic repository is the disaster-recovery copy: the whole database, encrypted, readable
only by restic with the password. A *suite snapshot* is a smaller, plainer thing — one
product's tests, templates, flows and steps as a single JSON file, the same document
`GET /api/products/{id}/export` returns. The app keeps those in the same bucket, as ordinary
objects under `suites/` beside the repository, using the same `BACKUP_REPOSITORY` and S3 key
(the `app` service in `compose.yaml` receives them; `BACKUP_PASSWORD` is not involved).

That gives a second kind of restore that needs neither restic nor downtime: a suite saved
last month can be brought back as a new product on this instance, or on any other Flowdeck
pointed at the same bucket, while everything else keeps running.

- In the web app: a product's overview has a **Suite** panel — *Save to backup*, *Download
  as a file*, *Import into this product* — and lists this product's snapshots with *Restore
  as new product*. The products page has *Import a suite* for a file or a snapshot.
- From a script: `POST /api/products/{id}/suites` saves one; `GET /api/suites` lists them;
  `POST /api/suites/{suiteId}/import { "into": "new" }` restores. See `docs/api.md`.

Snapshots are plain objects, so the bucket's own versioning and lifecycle rules apply to them
directly; Flowdeck never prunes them. `DELETE /api/suites/{suiteId}` removes one on request.

## Trying it locally

`backup/compose.minio.yaml` adds a throwaway MinIO to stand in for the network's S3:

```sh
# in .env
BACKUP_REPOSITORY=s3:http://minio:9000/flowdeck
BACKUP_PASSWORD=anything
BACKUP_S3_ACCESS_KEY=flowdeck
BACKUP_S3_SECRET_KEY=flowdeck-dev-secret

docker compose -f compose.yaml -f backup/compose.minio.yaml up -d --wait
docker compose exec backup flowdeck-backup            # one snapshot, now
docker compose exec backup flowdeck-restore --list
```

MinIO's console is on http://localhost:9001 with the same credentials.
