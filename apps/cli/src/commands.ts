/**
 * The commands. Each returns what it found — as text for a person and as a value
 * for `--json` — and throws `CliError` with an exit code when it cannot do its job.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_MAX_STEPS, describeChange, explainGiven, factName, GENERATED_TEMPLATE, generateFlows, KEY_PATTERN, type SuiteGraph, lintSuite, slugify, uniqueKey, type Suite, type SuiteFlow, type SuiteTemplate } from "@flowdeck/domain";
import { Client, CliError, EXIT, type IssueFeed } from "./client.ts";
import { flowFile, graphLines, listSuiteFiles, locate, readFolder, templateFile, testFile, writeFolder, writeTemplateFolder, type FileProblem } from "./files.ts";
import { agentsFile, AGENTS_MARKER, guide, TOPICS } from "./guide.ts";
import { localChanges, merge } from "./merge.ts";
import { configPath, findRoot, readBase, readConfig, readState, writeConfig, writeState, type ProjectState } from "./project.ts";

export interface Flags {
  json: boolean;
  url?: string;
  as?: string;
  dir?: string;
  plan: boolean;
  force: boolean;
  expect?: string;
  tags?: string;
  key?: string;
  slug?: string;
  precondition?: string;
  max?: string;
  replan: boolean;
  keepSetup: boolean;
}

/** What a command hands back: lines for a person, a value for `--json`, and the exit code. */
export interface Output {
  text: string[];
  json: unknown;
  code?: number;
}

const DEFAULT_URL = "http://localhost:8787";

async function client(flags: Flags, state?: ProjectState) {
  const config = await readConfig();
  const url = flags.url ?? process.env.FLOWDECK_URL ?? state?.url ?? config.url ?? DEFAULT_URL;
  const actor = flags.as ?? process.env.FLOWDECK_ACTOR ?? config.actor;
  return new Client(url, actor);
}

async function project(flags: Flags) {
  const root = findRoot(flags.dir ?? process.cwd());
  if (!root) throw new CliError("not in a Flowdeck folder: run flowdeck pull <product> first, or pass --dir", EXIT.usage);
  return { root, state: await readState(root) };
}

/* ── Problems ─────────────────────────────────────────────────────────── */

interface Located { level: "error" | "warning"; where: string; message: string }

function located(suite: Suite, files: FileProblem[], root?: string): Located[] {
  const graphFile = root ? join(root, "graph.yaml") : undefined;
  const lines = graphFile && suite.graph && existsSync(graphFile) ? graphLines(readFileSync(graphFile, "utf8")) : undefined;
  return [
    ...files.map((p) => ({ level: p.level, where: p.file, message: p.message })),
    ...lintSuite(suite).map((p) => ({ level: p.level, where: locate(suite, p.path, lines), message: p.message })),
  ].sort((a, b) => (a.level === b.level ? a.where.localeCompare(b.where, undefined, { numeric: true }) : a.level === "error" ? -1 : 1));
}

const problemLines = (ps: Located[]) => ps.map((p) => `${p.level === "error" ? "error  " : "warning"}  ${p.where}: ${p.message}`);
const tally = (ps: Located[]) => {
  const e = ps.filter((p) => p.level === "error").length;
  const w = ps.length - e;
  return `${e} ${e === 1 ? "error" : "errors"}, ${w} ${w === 1 ? "warning" : "warnings"}`;
};

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ── Commands ─────────────────────────────────────────────────────────── */

export async function login(args: string[], flags: Flags): Promise<Output> {
  const config = await readConfig();
  const url = args[0] ?? flags.url ?? config.url ?? DEFAULT_URL;
  const actor = flags.as ?? config.actor;
  const c = new Client(url, actor);
  await c.products(); // reachable, and speaks Flowdeck
  await writeConfig({ url, ...(actor ? { actor } : {}) });
  return {
    text: [
      `Using ${url}${actor ? ` as ${actor}` : ""}. Saved to ${configPath()}.`,
      ...(actor ? [] : [`Writes need a name: flowdeck login --as "<your name>".`]),
    ],
    json: { url, actor: actor ?? null },
  };
}

export async function products(_: string[], flags: Flags): Promise<Output> {
  const list = await (await client(flags)).products();
  const w = Math.max(4, ...list.map((p) => p.slug.length));
  return {
    text: list.length ? list.map((p) => `${p.slug.padEnd(w)}  ${p.name}`) : ["No products yet: flowdeck create \"<name>\""],
    json: list,
  };
}

export async function create(args: string[], flags: Flags): Promise<Output> {
  const name = args.join(" ").trim();
  if (!name) throw new CliError('name the product: flowdeck create "Relay"', EXIT.usage);
  const c = await client(flags);
  const p = await c.createProduct(name, flags.slug);
  const pulled = await pull([p.slug], flags);
  return { text: [`Created ${p.name} (${p.slug}).`, ...pulled.text], json: { product: p, ...(pulled.json as object) } };
}

export async function pull(args: string[], flags: Flags): Promise<Output> {
  const ref = args[0];
  const existing = findRoot(flags.dir ?? process.cwd());
  const c0 = await client(flags);

  if (existing && (!ref || ref === (await readState(existing)).product || ref === (await readState(existing)).productId)) {
    return pullInto(existing, await readState(existing), flags);
  }
  if (!ref) throw new CliError("which product? flowdeck pull <slug>   (flowdeck products lists them)", EXIT.usage);

  const p = await c0.product(ref);
  const root = resolve(flags.dir ?? p.slug);
  if (existsSync(join(root, ".flowdeck", "state.json"))) {
    const other = await readState(root);
    if (other.productId !== p.id) throw new CliError(`${root} already holds ${other.product}; choose another --dir`, EXIT.usage);
  }
  const state: ProjectState = { url: c0.url, product: p.slug, productId: p.id, revision: "", pulledAt: "" };
  return pullInto(root, state, flags);
}

async function pullInto(root: string, state: ProjectState, flags: Flags): Promise<Output> {
  const c = await client(flags, state);
  const remote = await c.suite(state.productId);
  const hasFiles = (await listSuiteFiles(root)).length > 0;
  const base = await readBase(root);

  let suite = remote.suite;
  let report: string[] = [];
  let merged: ReturnType<typeof merge> | undefined;
  if (hasFiles && !flags.force) {
    const local = await readFolder(root);
    if (local.problems.some((p) => p.level === "error")) {
      throw new CliError(`your files have errors, so they cannot be merged: fix them (flowdeck lint) or pull --force to discard your edits`, EXIT.invalid);
    }
    // No base (a fresh clone of a folder kept in git): your files are the edit.
    merged = merge(base ?? remote.suite, local.suite, remote.suite);
    suite = merged.suite;
    if (merged.taken.length) report.push(`From the server: ${merged.taken.join(", ")}`);
    if (merged.kept.length) report.push(`Your edits, kept: ${merged.kept.join(", ")}`);
    if (merged.conflicts.length) {
      report.push(`Changed on both sides — yours kept, and a push will overwrite the server's: ${merged.conflicts.join(", ")}`);
    }
  }

  const { written, removed } = await writeFolder(root, suite);
  await writeState(root, { ...state, url: c.url, revision: remote.revision, pulledAt: new Date().toISOString() }, remote.suite);
  const agents = join(root, "AGENTS.md");
  if (!existsSync(agents) || (await readFile(agents, "utf8")).startsWith(AGENTS_MARKER)) await writeFile(agents, agentsFile(remote.suite.product.name));

  if (!report.length) report = [written.length || removed.length ? `${written.length} written, ${removed.length} removed.` : "Already up to date."];
  return {
    text: [`${remote.suite.product.name} → ${root} (revision ${remote.revision})`, ...report],
    json: { root, revision: remote.revision, written, removed, ...(merged ? { taken: merged.taken, kept: merged.kept, conflicts: merged.conflicts } : {}) },
  };
}

export async function lint(_: string[], flags: Flags): Promise<Output> {
  const root = findRoot(flags.dir ?? process.cwd()) ?? resolve(flags.dir ?? ".");
  const { suite, problems } = await readFolder(root);
  const all = located(suite, problems, root);
  const errors = all.filter((p) => p.level === "error").length;
  return {
    text: [...problemLines(all), all.length ? tally(all) : "No problems."],
    json: { errors, warnings: all.length - errors, problems: all },
    code: errors ? EXIT.invalid : EXIT.ok,
  };
}

export async function status(_: string[], flags: Flags): Promise<Output> {
  const { root, state } = await project(flags);
  const base = await readBase(root);
  const { suite, problems } = await readFolder(root);
  const changes = base ? localChanges(base, suite) : [];
  const all = located(suite, problems, root);
  const lines = changes.map(describeChange);
  return {
    text: [
      `${state.product} at revision ${state.revision}, pulled ${new Date(state.pulledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
      ...(lines.length ? ["", "Changed here since the pull:", ...lines.map((l) => `  ${l}`)] : ["Nothing changed since the pull."]),
      ...(all.length ? ["", `${tally(all)} — flowdeck lint`] : []),
    ],
    json: { product: state.product, revision: state.revision, changes, summary: lines, errors: all.filter((p) => p.level === "error").length, warnings: all.filter((p) => p.level === "warning").length },
  };
}

export async function push(_: string[], flags: Flags): Promise<Output> {
  const { root, state } = await project(flags);
  const { suite, problems } = await readFolder(root);
  const all = located(suite, problems, root);
  if (all.some((p) => p.level === "error")) {
    return { text: [...problemLines(all), `${tally(all)}: nothing pushed.`], json: { pushed: false, problems: all }, code: EXIT.invalid };
  }
  // The full list is lint's job; here a count is enough to make someone look.
  const warnings = all.length ? [`${tally(all)} — flowdeck lint lists them`] : [];
  const c = await client(flags, state);

  if (flags.plan) {
    const plan = await c.plan(state.productId, suite);
    const stale = plan.revision !== state.revision;
    return {
      text: [
        ...warnings,
        ...(plan.summary.length ? plan.summary : ["Nothing to push."]),
        ...(stale && !flags.force ? ["", "The server's suite changed since your pull: push will be refused. Run flowdeck pull first (it merges)."] : []),
      ],
      json: { ...plan, stale, problems: all },
    };
  }

  try {
    const res = await c.push(state.productId, suite, state.revision, flags.force);
    // Write back the server's form of what was pushed, so the folder and the base agree exactly.
    const now = await c.suite(state.productId);
    await writeFolder(root, now.suite);
    await writeState(root, { ...state, url: c.url, revision: now.revision, pulledAt: new Date().toISOString() }, now.suite);
    return {
      text: [...warnings, ...(res.summary.length ? res.summary : ["Nothing to push: the server already has exactly this."]), ...(res.summary.length ? [`Pushed. Revision ${now.revision}.`] : [])],
      json: { pushed: true, ...res, revision: now.revision },
    };
  } catch (e) {
    if (e instanceof CliError && e.code === EXIT.stale) {
      throw new CliError("someone changed the suite since your pull. Run flowdeck pull (it merges your edits), then push again — or push --force to overwrite their changes", EXIT.stale);
    }
    throw e;
  }
}

async function takenKeys(dir: string, suffix: string) {
  if (!existsSync(dir)) return new Set<string>();
  return new Set((await readdir(dir)).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)));
}

function chooseKey(wanted: string | undefined, from: string, taken: Set<string>) {
  if (wanted) {
    if (!KEY_PATTERN.test(wanted)) throw new CliError(`"${wanted}" is not a key: lowercase letters, digits and single hyphens`, EXIT.usage);
    if (taken.has(wanted)) throw new CliError(`"${wanted}" is taken`, EXIT.usage);
    return wanted;
  }
  return uniqueKey(slugify(from), taken);
}

export async function newThing(args: string[], flags: Flags): Promise<Output> {
  const [what, ...rest] = args;
  const root = findRoot(flags.dir ?? process.cwd()) ?? resolve(flags.dir ?? ".");

  if (what === "test") {
    const title = rest.join(" ").trim();
    if (!title) throw new CliError('flowdeck new test "<what must be true>" --expect "<what the tester sees>"', EXIT.usage);
    const key = chooseKey(flags.key, title, await takenKeys(join(root, "tests"), ".yaml"));
    const file = join(root, "tests", `${key}.yaml`);
    await mkdir(join(root, "tests"), { recursive: true });
    const tags = flags.tags?.split(",").map((t) => t.trim()).filter(Boolean);
    await writeFile(file, testFile({ key, title, expect: flags.expect ?? "", ...(tags?.length ? { tags } : {}) }));
    return {
      text: [`tests/${key}.yaml`, ...(flags.expect ? [] : ["Fill in expect: what the tester sees when it holds."]), `Verify it from a flow step: verifies: [${key}]`],
      json: { key, file },
    };
  }

  if (what === "flow") {
    const [template, ...nameParts] = rest;
    const name = nameParts.join(" ").trim();
    if (!template || !name) throw new CliError('flowdeck new flow <template-key> "<what the tester does>"', EXIT.usage);
    const dir = join(root, "templates", template);
    const tfile = join(dir, "template.yaml");
    if (!existsSync(tfile)) throw new CliError(`no template "${template}": flowdeck new template "<name>" makes one`, EXIT.usage);
    const key = chooseKey(flags.key, name, await takenKeys(dir, ".flow.yaml"));
    await writeFile(join(dir, `${key}.flow.yaml`), flowFile({ key, name, ...(flags.precondition ? { precondition: flags.precondition } : {}), steps: [] }));
    const t = Bun.YAML.parse(await readFile(tfile, "utf8")) as { name?: string; description?: string; archived?: boolean; flows?: string[] } | null;
    const order = [...(t?.flows ?? []), key];
    await writeFile(tfile, templateFile({ name: t?.name ?? template, ...(t?.description ? { description: t.description } : {}), ...(t?.archived ? { archived: true } : {}), flows: order.map((k) => ({ key: k })) }));
    return { text: [`templates/${template}/${key}.flow.yaml (last in ${template}'s flows)`, "Add steps: flowdeck guide steps"], json: { key, template, file: join(dir, `${key}.flow.yaml`) } };
  }

  if (what === "template") {
    const name = rest.join(" ").trim();
    if (!name) throw new CliError('flowdeck new template "<the kind of testing day>"', EXIT.usage);
    const taken = existsSync(join(root, "templates")) ? new Set(await readdir(join(root, "templates"))) : new Set<string>();
    const key = chooseKey(flags.key, name, taken);
    await mkdir(join(root, "templates", key), { recursive: true });
    await writeFile(join(root, "templates", key, "template.yaml"), templateFile({ name, flows: [] }));
    return { text: [`templates/${key}/template.yaml`, `Add flows: flowdeck new flow ${key} "<name>"`], json: { key, file: join(root, "templates", key, "template.yaml") } };
  }

  throw new CliError("flowdeck new test|flow|template …", EXIT.usage);
}

export async function coverage(_: string[], flags: Flags): Promise<Output> {
  const root = findRoot(flags.dir ?? process.cwd()) ?? resolve(flags.dir ?? ".");
  const { suite } = await readFolder(root);
  const verifiedBy = new Map<string, string[]>();
  for (const t of suite.templates) for (const f of t.flows) for (const s of f.steps) for (const k of s.verifies ?? []) {
    verifiedBy.set(k, [...new Set([...(verifiedBy.get(k) ?? []), `${t.key}/${f.key}`])]);
  }
  const live = suite.tests.filter((t) => !t.archived);
  const uncovered = live.filter((t) => !verifiedBy.has(t.key));
  const templates = suite.templates.map((t) => ({
    key: t.key,
    flows: t.flows.filter((f) => !f.archived).length,
    steps: t.flows.reduce((n, f) => n + f.steps.length, 0),
    tests: new Set(t.flows.flatMap((f) => f.steps.flatMap((s) => s.verifies ?? []))).size,
    devices: [...new Set(t.flows.flatMap((f) => f.steps.map((s) => s.device)))],
  }));
  return {
    text: [
      `${live.length - uncovered.length} of ${live.length} tests are verified by some flow.`,
      ...(uncovered.length ? ["", "In no flow (never checked on a testing day):", ...uncovered.map((t) => `  tests/${t.key}.yaml  ${t.title}`)] : []),
      "",
      ...templates.map((t) => `${t.key}: ${count(t.flows, "flow")}, ${count(t.steps, "step")}, ${count(t.tests, "test")}, on ${t.devices.join(", ") || "no devices"}`),
    ],
    json: { total: live.length, covered: live.length - uncovered.length, uncovered: uncovered.map((t) => t.key), verifiedBy: Object.fromEntries(verifiedBy), templates },
  };
}

const GENERATED_DESCRIPTION = "Worked out by flowdeck generate from graph.yaml and each test's given. Edit those and run it again: edits made here are overwritten.";

/** How much longer than planning from nothing an update may get before it is worth saying. */
const DRIFT = 0.1;

export async function generate(_: string[], flags: Flags): Promise<Output> {
  const root = findRoot(flags.dir ?? process.cwd()) ?? resolve(flags.dir ?? ".");
  const { suite, problems } = await readFolder(root);
  if (!suite.graph) throw new CliError("no graph.yaml here: describe how a person moves through the app first (flowdeck guide graph)", EXIT.usage);
  const errors = located(suite, problems, root).filter((p) => p.level === "error");
  if (errors.length) return { text: [...problemLines(errors), `${tally(errors)}: nothing generated.`], json: { generated: false, problems: errors }, code: EXIT.invalid };

  const maxSteps = flags.max === undefined ? DEFAULT_MAX_STEPS : Number(flags.max);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new CliError(`--max is the longest a flow may be, in steps: a whole number, not "${flags.max}"`, EXIT.usage);

  const existing = suite.templates.find((t) => t.key === GENERATED_TEMPLATE);
  const previous = flags.replan ? undefined : existing?.flows;
  const g = generateFlows(suite, { maxSteps, ...(flags.keepSetup ? { setupSteps: Infinity } : {}), ...(previous ? { previous } : {}) });
  const tpl: SuiteTemplate = {
    key: GENERATED_TEMPLATE,
    name: existing?.name ?? "Generated flows",
    description: existing?.description ?? GENERATED_DESCRIPTION,
    ...(existing?.archived ? { archived: true } : {}),
    flows: g.flows,
  };
  const { written, removed } = await writeTemplateFolder(root, tpl);

  const flowOf = (flows: readonly SuiteFlow[]) => new Map(flows.flatMap((f) => f.steps.flatMap((s) => (s.verifies ?? []).map((k) => [k, f.key] as const))));
  const before = flowOf(existing?.flows ?? []), after = flowOf(g.flows);
  const moved = [...after].filter(([k, f]) => before.has(k) && before.get(k) !== f).map(([k]) => k);
  const added = [...after.keys()].filter((k) => !before.has(k));
  const dropped = [...before.keys()].filter((k) => !after.has(k));
  const tests = after.size;
  const drift = g.fresh && (g.flows.length > g.fresh.flows || g.steps > g.fresh.steps * (1 + DRIFT)) ? g.fresh : undefined;

  return {
    text: [
      `${count(g.flows.length, "flow")}, ${count(g.steps, "step")}, ${count(tests, "test")} (at most ${maxSteps} steps a flow).`,
      ...g.flows.map((f) => `  ${f.key}  ${count(f.steps.length, "step")}, ${count(f.steps.filter((s) => s.kind === "check").length, "test")}: ${f.name}`),
      // The first run adds everything; the list says nothing then.
      ...(added.length && before.size ? [`New: ${added.join(", ")}`] : []),
      ...(dropped.length ? [`No longer generated: ${dropped.join(", ")}`] : []),
      ...(moved.length ? [`Moved to another flow: ${moved.join(", ")}`] : []),
      ...(g.unplaced.length > g.gaveUp.length ? [`Not reachable within ${maxSteps} steps, so in no generated flow: ${g.unplaced.filter((k) => !g.gaveUp.includes(k)).join(", ")}. Raise --max, or give the graph a shorter way there (flowdeck graph explain <test>).`] : []),
      ...(g.gaveUp.length ? [`The search gave up on ${g.gaveUp.join(", ")}: too many combinations of facts to search, so this is not proof they cannot be reached. Fewer facts help most — merge or drop the ones these tests do not need.`] : []),
      ...(drift ? [`Planning from nothing would take ${count(drift.flows, "flow")}, ${count(drift.steps, "step")}: flowdeck generate --replan (tests move between flows).`] : []),
      "",
      written.length || removed.length
        ? `templates/${GENERATED_TEMPLATE}: ${written.length} written, ${removed.length} removed. flowdeck push --plan shows what a push would change.`
        : `templates/${GENERATED_TEMPLATE} is already up to date.`,
    ],
    json: { generated: true, template: GENERATED_TEMPLATE, maxSteps, flows: g.flows.map((f) => ({ key: f.key, name: f.name, steps: f.steps.length, tests: f.steps.flatMap((s) => s.verifies ?? []) })), steps: g.steps, unplaced: g.unplaced, gaveUp: g.gaveUp, added, dropped, moved, fresh: g.fresh ?? null, written, removed },
  };
}

const asList = (x: string | string[]) => (Array.isArray(x) ? x : [x]);

/** The graph as text: per role, per screen, the ways out, and the tests that are checked there. */
function outline(suite: Suite, graph: SuiteGraph): string[] {
  const lines: string[] = [];
  const conditions = (a: SuiteGraph["actions"][number]) => [a.needs?.length ? `needs ${a.needs.join(", ")}` : "", a.sets?.length ? `sets ${a.sets.join(", ")}` : ""].filter(Boolean).join("; ");
  for (const [key, r] of Object.entries(graph.roles)) {
    lines.push(`${key}: ${r.name}, on ${r.surface}${r.usually ? ` (usually ${r.usually})` : ""}`);
    for (const screen of graph.screens[r.surface] ?? []) {
      const starts = Object.entries(graph.starts).filter(([, st]) => st.at[key] === screen).map(([k]) => k);
      lines.push(`  ${screen}${starts.length ? `   [start: ${starts.join(", ")}]` : ""}`);
      for (const a of graph.actions) {
        if (!asList(a.device).includes(key) || !asList(a.from).includes(screen)) continue;
        const to = a.to ?? screen;
        const cond = conditions(a);
        lines.push(`    ${to === screen ? "(stays)" : `→ ${to}`}  ${a.do}${cond ? `   (${cond})` : ""}`);
      }
      for (const t of suite.tests) {
        if (t.given?.device !== key || t.given.at !== screen || t.archived) continue;
        lines.push(`    ✓ ${t.key}${t.given.facts?.length ? `   (with ${t.given.facts.join(", ")})` : ""}`);
      }
    }
  }
  lines.push("", "facts:", ...Object.entries(graph.facts).map(([f, m]) => `  ${f}: ${m}`));
  return lines;
}

/** The graph as a Mermaid flowchart: one box per role, screens as nodes, actions as arrows. */
function mermaid(graph: SuiteGraph): string[] {
  const id = (role: string, screen: string) => `${role}__${screen}`.replace(/[^A-Za-z0-9_]/g, "_");
  const label = (s: string) => s.replace(/"/g, "#quot;");
  const lines = ["flowchart LR"];
  for (const [key, r] of Object.entries(graph.roles)) {
    lines.push(`  subgraph ${id(key, "")}["${label(r.name)}"]`);
    for (const screen of graph.screens[r.surface] ?? []) lines.push(`    ${id(key, screen)}["${label(screen)}"]`);
    lines.push("  end");
  }
  for (const a of graph.actions) {
    for (const role of asList(a.device)) for (const from of asList(a.from)) {
      const facts = [...(a.needs ?? []).map((n) => `if ${n}`), ...(a.sets ?? []).map((x) => (x.startsWith("-") ? `clears ${factName(x)}` : `sets ${factName(x)}`))];
      lines.push(`  ${id(role, from)} -->|"${label(a.do)}${facts.length ? `<br/>${label(facts.join(", "))}` : ""}"| ${id(role, a.to ?? from)}`);
    }
  }
  return lines;
}

export async function graphCmd(args: string[], flags: Flags): Promise<Output> {
  const [what = "show", ...rest] = args;
  const root = findRoot(flags.dir ?? process.cwd()) ?? resolve(flags.dir ?? ".");
  const { suite, problems } = await readFolder(root);
  const graph = suite.graph;
  if (!graph) throw new CliError("no graph.yaml here: flowdeck guide build-graph says how to write one", EXIT.usage);
  // An unreachable given is what explain is for; any other error makes the answers meaningless.
  const errors = located(suite, problems, root).filter((p) => p.level === "error" && !(what === "explain" && p.message.startsWith("no start can reach")));
  if (errors.length) return { text: [...problemLines(errors), `${tally(errors)}: fix these first (flowdeck lint).`], json: { problems: errors }, code: EXIT.invalid };

  if (what === "show") return { text: outline(suite, graph), json: graph };
  if (what === "mermaid") return { text: mermaid(graph), json: { mermaid: mermaid(graph).join("\n") } };
  if (what === "explain") {
    const [key, start] = rest;
    if (!key) throw new CliError("flowdeck graph explain <test-key> [start]", EXIT.usage);
    if (!suite.tests.some((t) => t.key === key)) throw new CliError(`no test "${key}"`, EXIT.usage);
    if (start && !graph.starts[start]) throw new CliError(`no start "${start}": the starts are ${Object.keys(graph.starts).join(", ")}`, EXIT.usage);
    const e = explainGiven(suite, key, start);
    if (e.status === "no-given") return { text: [`${key} has no given, so no generated flow checks it: add one (flowdeck guide graph).`], json: e };
    if (e.status !== "reachable") return { text: [`${key} cannot be reached${e.status === "unknown" ? " (as far as the search could tell)" : ""}:`, ...e.reasons.map((r) => `  - ${r}`)], json: e, code: EXIT.invalid };
    const generated = suite.templates.find((t) => t.key === GENERATED_TEMPLATE)?.flows.find((f) => f.steps.some((s) => s.verifies?.includes(key)));
    const far = Object.entries(e.fromEachStart).map(([k, n]) => `${k}: ${n === null ? "no way" : count(n, "step")}`).join(", ");
    return {
      text: [
        `${key}: ${count(e.steps.length - 1, "step")} from ${e.start} (${graph.starts[e.start]!.say})`,
        ...e.steps.map((s, i) => `  ${String(i + 1).padStart(2)}. [${s.device}] ${s.kind === "check" ? "✓ " : ""}${s.text}`),
        "",
        `From each start: ${far}.`,
        generated ? `Checked in templates/${GENERATED_TEMPLATE}/${generated.key}.flow.yaml.` : "In no generated flow yet: flowdeck generate.",
      ],
      json: e,
    };
  }
  throw new CliError("flowdeck graph show | mermaid | explain <test-key> [start]", EXIT.usage);
}

export async function report(args: string[], flags: Flags): Promise<Output> {
  const { root, state } = await project(flags);
  const c = await client(flags, state);
  let runId = args[0];
  if (!runId) {
    const runs = await c.runs(state.productId);
    if (!runs.length) return { text: ["No testing days yet."], json: null };
    runId = runs[0]!.id;
  }
  const feed = await c.issues(runId);
  const flowFileOf = (ctx: IssueFeed["issues"][number]["context"]) =>
    ctx.flowKey && feed.run.templateKey ? `templates/${feed.run.templateKey}/${ctx.flowKey}.flow.yaml step ${ctx.stepNumber}` : `${ctx.flow}, step ${ctx.stepNumber}`;
  const group = (type: string) => feed.issues.filter((i) => i.type === type);
  // A test archived since the day ran has no file any more; name it instead of pointing nowhere.
  const testRef = (t: IssueFeed["issues"][number]["test"]) =>
    t.key && existsSync(join(root, "tests", `${t.key}.yaml`)) ? `tests/${t.key}.yaml` : `"${t.title}" (archived)`;
  const line = (i: IssueFeed["issues"][number]) =>
    `  ${testRef(i.test)} — ${i.note ?? ""}${i.blocking ? " [blocked the rest of the flow]" : ""}\n      at ${flowFileOf(i.context)} (${i.context.device}), by ${i.recordedBy}`;
  const sections: [string, string[]][] = [
    ["Failures", group("failure").map(line)],
    ["Minor", group("minor").map(line)],
    ["Tests that are wrong (skipped) — fix the test", group("invalid_test").map(line)],
    ["Steps flagged as wrong — fix the flow", feed.stepProblems.map((p) => `  ${flowFileOf(p.context)} — ${p.note}${p.workaround ? `\n      got past it by: ${p.workaround}` : " [could not get past it]"}`)],
  ];
  return {
    text: [
      `${feed.run.template}, ${feed.run.date.slice(0, 10)}${feed.run.closedAt ? " (closed)" : " (open)"}`,
      ...sections.filter(([, l]) => l.length).flatMap(([h, l]) => ["", `${h}:`, ...l]),
      ...(feed.issues.length || feed.stepProblems.length ? [] : ["", "Nothing to report: every recorded result passed."]),
    ],
    json: { ...feed, root },
  };
}

export async function guideCmd(args: string[]): Promise<Output> {
  const text = guide(args[0]);
  if (!text) throw new CliError(`no guide on "${args[0]}". Topics: ${Object.keys(TOPICS).join(", ")}, all`, EXIT.usage);
  return { text: [text], json: { topic: args[0] ?? "overview", text } };
}
