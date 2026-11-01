# The `flowdeck` CLI

Write a suite as files — by hand or with an agent — and land it in Flowdeck in one reviewed
step. The CLI is a thin client over the suite routes in [`api.md`](api.md); everything it does,
a script can do with `curl`.

```sh
bun run cli -- guide              # from the repo: how to write tests and flows
bun run --cwd apps/cli build      # or a standalone binary at apps/cli/dist/flowdeck
```

## The loop

```sh
flowdeck login https://flowdeck.example.com --as "Noa"
flowdeck pull relay               # writes ./relay
cd relay
flowdeck new test "Reactions show who reacted" --expect "Long-pressing a reaction lists everyone who added it."
$EDITOR templates/monthly-regression/messaging-across-two-devices.flow.yaml
flowdeck lint                     # offline: the rules, with the file and step for each problem
flowdeck status                   # offline: what you changed since the pull
flowdeck push --plan              # what the server would change; nothing is written
flowdeck push                     # one transaction
```

After a testing day, `flowdeck report` lists every failure, minor issue, wrong test and step
flagged as wrong, each pointing at the file (and step) to look at. `flowdeck coverage` lists
the tests no flow verifies.

## The files

```
relay/
  product.yaml                                   name, description
  tests/<key>.yaml                               title, expect, tags, metadata, archived
  templates/<key>/template.yaml                  name, description, archived, flows: [in order]
  templates/<key>/<flow-key>.flow.yaml           name, precondition, estimateMinutes, archived, steps
  AGENTS.md                                      generated: the rules, for an agent working here
  .flowdeck/                                     the server, the product, the copy last pulled
```

A flow:

```yaml
name: Messaging across two devices
precondition: Relay installed on both phones, signed in as qa-1 (Pixel 8) and qa-2 (iPhone 13).
estimateMinutes: 15
steps:
  - do: Send the message "hello".
    device: Pixel 8
  - check: Watch the message as it sends.
    device: Pixel 8
    expect: It appears at once with a pending clock, then a single check.
    verifies: [sending-a-message-shows-it-optimistically]
  - do: Open the chat with qa-1.
    device: iPhone 13
    after: "\"hello\" is the last message"
```

A complete folder is in [`examples/relay/`](examples/relay/).

**File names are keys.** Keys are lowercase words joined by hyphens, unique in their scope,
and they are how a push matches files to what the server has. Editing a file changes that
thing (an edited test gets a new version; old results keep the old wording). Renaming a file
is a new key: the old thing is archived, a new one created. Deleting a file archives it —
nothing is ever deleted on the server, and putting the file back restores it.

Unknown fields are errors, so `expected:` or `devices:` is caught rather than ignored.

## The rules

`flowdeck guide steps` explains each; `flowdeck lint` checks what can be checked.

| Rule | Lint |
|---|---|
| A test is an assertion with an observable `expect`, never a procedure | error if `expect` is empty |
| **One device per step.** Two devices means two steps; never "both screens" | warning when a step names another device or "both/each/all" devices |
| **One thing per step.** No "and", no "then": "Open the chat and send hi" is two steps | warning on a second instruction joined by and / then / ; / a comma |
| A `check:` says what to see (`expect:`); a `do:` does not | warnings |
| `verifies:` names tests that exist | error |
| Every live test is verified by some flow | warning |
| One device, one name ("iPhone 13", never also "iphone") | warning on near-duplicates |

Errors stop a push. Warnings are said and allowed — some are judgement calls.

## When someone else changed the suite

A pull records the suite's *revision*. A push names it, and the server refuses (exit code 3)
if the suite has changed since — someone pushed, or edited in the app. Run `flowdeck pull`:

- what only they changed comes in,
- what only you changed stays,
- anything you both changed keeps yours and is listed by name, so the next push overwrites
  theirs knowingly.

Then push again. `flowdeck push --force` skips the check and overwrites.

## For scripts and agents

- Every command takes `--json`.
- Exit codes: `0` ok, `1` the suite has errors, `2` usage (or no identity), `3` the server's
  suite moved on, `4` the server failed or is unreachable.
- Identity: `--as <name>`, `FLOWDECK_ACTOR`, or `flowdeck login --as`. Server: `--url`,
  `FLOWDECK_URL`, or `flowdeck login <url>`.
- A server with a self-signed or internal-CA certificate: point `NODE_EXTRA_CA_CERTS` at the
  CA certificate (for the bundled Caddy on `localhost`, `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .`).
- `flowdeck guide all` is the whole guide in one read; a pull writes it in short as `AGENTS.md`.

## Commands

| Command | What |
|---|---|
| `guide [overview\|tests\|flows\|steps\|files\|workflow\|all]` | How to write a suite |
| `login [url] --as <name>` | Remember the server and your name (`~/.config/flowdeck/config.json`) |
| `products` | Slugs and names |
| `create "<name>" [--slug s]` | Make a product and pull it |
| `pull [product] [--dir d] [--force]` | First time: write the folder. Inside one: merge. `--force` discards local edits |
| `status` | Local changes since the pull, and a lint tally |
| `lint` | Every problem, with file and step |
| `push [--plan] [--force]` | Plan, or apply |
| `new test "<title>" --expect "<seen>" [--tags a,b] [--key k]` | A correctly named test file |
| `new flow <template> "<name>" [--precondition "<state>"]` | A flow file, appended to the template's order |
| `new template "<name>"` | A template folder |
| `coverage` | Tests in no flow; per template: flows, steps, tests, devices |
| `report [run-id]` | The latest (or given) testing day's findings, pointing at files |
