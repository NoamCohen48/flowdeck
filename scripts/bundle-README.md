# Flowdeck {{VERSION}}

Manual testing days for your team: tests say what must be true, flows say what a
person does, and everyone's results land live on one board.

## Start

You need a Linux server with Docker (and its compose plugin).

```sh
./start.sh
```

Open the address it prints. On `localhost` the browser warns about the certificate
the first time; that is expected, and a real hostname gets a proper one.

The first start also loads a sample product, Relay, so there is something to look at.
Turn that off with `SEED_DEMO=false` in `.env` before the first start.

## Set it up for your team

Everything is in `.env` (created by the first `./start.sh`). The ones that matter:

| Setting | What |
|---|---|
| `SITE_ADDRESS` | The hostname people will open, e.g. `flowdeck.example.com` |
| `POSTGRES_PASSWORD` | The database password. Change it before the first start |
| `BACKUP_REPOSITORY`, `BACKUP_PASSWORD` | Where backups go, and the password that encrypts them |

After editing, run `./start.sh` again.

## The CLI

`cli/` (in the offline bundle) holds the `flowdeck` command line for writing tests
and flows as files, by hand or with an AI agent. Pick the one for your computer:

| File | For |
|---|---|
| `flowdeck-linux-x64`, `flowdeck-linux-arm64` | Linux |
| `flowdeck-darwin-arm64`, `flowdeck-darwin-x64` | macOS (Apple silicon, Intel) |
| `flowdeck-windows-x64.exe` | Windows |

```sh
cp cli/flowdeck-linux-x64 /usr/local/bin/flowdeck && chmod +x /usr/local/bin/flowdeck
flowdeck login https://flowdeck.example.com --as "Your name"
flowdeck guide
```

On `localhost`, or with your own internal certificate authority, the CLI needs to trust it:
`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` and then
`export NODE_EXTRA_CA_CERTS=$PWD/root.crt`.

## Everyday

| To | Run |
|---|---|
| Stop | `docker compose stop` |
| Start again | `./start.sh` |
| See what it is doing | `docker compose logs -f app` |
| Upgrade | Unpack the next release over this folder (keep `.env`), then `./start.sh` |
| Restore a backup | Follow [the backup guide](https://github.com/NoamCohen48/flowdeck/blob/v{{VERSION}}/docs/backup.md) |

Your data lives in Docker volumes, not in this folder, so an upgrade keeps it.
Full documentation: https://github.com/NoamCohen48/flowdeck/tree/v{{VERSION}}/docs
