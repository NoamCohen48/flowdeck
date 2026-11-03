#!/usr/bin/env bun
/**
 * flowdeck — author a Flowdeck suite as files, from a terminal or an agent.
 */
import { parseArgs } from "node:util";
import { version } from "../../../package.json" with { type: "json" };
import { CliError, EXIT } from "./client.ts";
import * as cmd from "./commands.ts";
import type { Flags, Output } from "./commands.ts";

const HELP = `flowdeck — a Flowdeck suite as files

  flowdeck guide [topic]                 how to write tests and flows (start here)
  flowdeck login [url] --as <name>       remember the server and who you are
  flowdeck products                      list products
  flowdeck create "<name>" [--slug s]    make a product and pull it
  flowdeck pull [product] [--dir d]      fetch the suite into files; inside a folder, merge
  flowdeck status                        what you changed since the pull (offline)
  flowdeck lint                          check the files against the rules (offline)
  flowdeck push --plan                   what a push would change, without changing it
  flowdeck push [--force]                apply your files to the server
  flowdeck new test "<title>" --expect "<seen>" [--tags a,b]
  flowdeck new flow <template> "<name>" [--precondition "<state>"]
  flowdeck new template "<name>"
  flowdeck coverage                      which tests no flow verifies (offline)
  flowdeck generate [--max 25] [--replan] [--keep-setup]
                                         flows from graph.yaml and each test's given (offline)
  flowdeck graph show                    the graph per device: screens, ways out, tests checked there
  flowdeck graph explain <test> [start]  the shortest way to a test's state, or why there is none
  flowdeck graph mermaid                 the graph as a Mermaid diagram
  flowdeck report [run-id]               what testers found on the latest testing day

Options: --json for machine output, --url, --as <name>, --dir <folder>, --key <key>
Environment: FLOWDECK_URL, FLOWDECK_ACTOR
Exit codes: 0 ok, 1 the suite has errors, 2 usage, 3 the server's suite changed, 4 server`;

const COMMANDS: Record<string, (args: string[], flags: Flags) => Promise<Output>> = {
  login: cmd.login,
  products: cmd.products,
  create: cmd.create,
  pull: cmd.pull,
  status: cmd.status,
  lint: cmd.lint,
  push: cmd.push,
  plan: (a, f) => cmd.push(a, { ...f, plan: true }),
  new: cmd.newThing,
  coverage: cmd.coverage,
  generate: cmd.generate,
  graph: cmd.graphCmd,
  report: cmd.report,
  guide: (a) => cmd.guideCmd(a),
};

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
        url: { type: "string" },
        as: { type: "string" },
        dir: { type: "string" },
        plan: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        expect: { type: "string" },
        tags: { type: "string" },
        key: { type: "string" },
        slug: { type: "string" },
        precondition: { type: "string" },
        max: { type: "string" },
        replan: { type: "boolean", default: false },
        "keep-setup": { type: "boolean", default: false },
      },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${HELP}`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  const [name, ...args] = positionals;
  if (values.version) { console.log(`flowdeck ${version}`); return EXIT.ok; }
  if (!name || values.help || name === "help") { console.log(HELP); return name || values.help ? EXIT.ok : EXIT.usage; }

  const run = COMMANDS[name];
  if (!run) { console.error(`unknown command "${name}"\n\n${HELP}`); return EXIT.usage; }

  const flags: Flags = {
    json: values.json!, plan: values.plan!, force: values.force!, replan: values.replan!, keepSetup: values["keep-setup"]!,
    ...(values.url ? { url: values.url } : {}),
    ...(values.as ? { as: values.as } : {}),
    ...(values.dir ? { dir: values.dir } : {}),
    ...(values.expect ? { expect: values.expect } : {}),
    ...(values.tags ? { tags: values.tags } : {}),
    ...(values.key ? { key: values.key } : {}),
    ...(values.slug ? { slug: values.slug } : {}),
    ...(values.precondition ? { precondition: values.precondition } : {}),
    ...(values.max ? { max: values.max } : {}),
  };

  try {
    const out = await run(args, flags);
    if (flags.json) console.log(JSON.stringify(out.json, null, 2));
    else if (out.text.length) console.log(out.text.join("\n"));
    return out.code ?? EXIT.ok;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    if (flags.json) console.log(JSON.stringify({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) }, null, 2));
    else {
      console.error(`flowdeck: ${e.message}`);
      if (Array.isArray(e.details)) for (const d of e.details as { message?: string }[]) console.error(`  ${d.message ?? JSON.stringify(d)}`);
    }
    return e.code;
  }
}

process.exit(await main(process.argv.slice(2)));
