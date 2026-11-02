/**
 * The suite as a folder, one file per thing a person edits:
 *
 *   product.yaml                          name, description
 *   graph.yaml                            how a person moves through the app (optional)
 *   tests/<key>.yaml                      one test: title, expect, tags, given
 *   templates/<key>/template.yaml         name, description, the flows in order
 *   templates/<key>/<flow>.flow.yaml      one flow: name, precondition, steps
 *
 * A file's name is its key, so renaming a file is changing a key (which archives
 * the old one and creates a new one on push — `flowdeck guide files` says so).
 * Steps say `do:` or `check:`, never `kind:`; that is the one place the files
 * and the API differ, because a file is read far more often than it is parsed.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { GraphAction, Suite, SuiteFlow, SuiteGraph, SuiteStep, SuiteTemplate, SuiteTest, TestGiven } from "@flowdeck/domain";
import { toYaml, type YamlValue } from "./yaml.ts";

/** A problem with a file itself, before the suite's own rules are even asked. */
export interface FileProblem {
  level: "error" | "warning";
  file: string;
  message: string;
}

/* ── Writing ──────────────────────────────────────────────────────────── */

const omitEmpty = <T extends Record<string, YamlValue | undefined>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as T;

const givenYaml = (g: TestGiven) => omitEmpty({
  device: g.device,
  at: g.at,
  facts: g.facts ? [...g.facts] : undefined,
  also: g.also && Object.keys(g.also).length ? { ...g.also } : undefined,
  look: g.look,
});

export function testFile(t: SuiteTest): string {
  return toYaml(omitEmpty({
    title: t.title,
    expect: t.expect,
    tags: t.tags ? [...t.tags] : undefined,
    given: t.given ? givenYaml(t.given) : undefined,
    metadata: t.metadata && Object.keys(t.metadata).length ? (t.metadata as { [k: string]: YamlValue }) : undefined,
    archived: t.archived ? true : undefined,
  }));
}

function stepYaml(s: SuiteStep): { [k: string]: YamlValue | undefined } {
  return omitEmpty({
    ...(s.kind === "check" ? { check: s.text } : { do: s.text }),
    device: s.device,
    expect: s.kind === "check" ? s.expect ?? undefined : undefined,
    after: s.after ?? undefined,
    verifies: s.verifies ? [...s.verifies] : undefined,
  });
}

export function flowFile(f: SuiteFlow): string {
  return toYaml({
    ...omitEmpty({
      name: f.name,
      precondition: f.precondition,
      estimateMinutes: f.estimateMinutes ?? undefined,
      archived: f.archived ? true : undefined,
    }),
    steps: f.steps.map(stepYaml),
  });
}

export function templateFile(t: SuiteTemplate | { name: string; description?: string; archived?: boolean; flows: readonly { key: string }[] }): string {
  return toYaml({
    ...omitEmpty({ name: t.name, description: t.description, archived: t.archived ? true : undefined }),
    flows: t.flows.map((f) => f.key),
  });
}

export function productFile(p: Suite["product"]): string {
  return toYaml(omitEmpty({ name: p.name, description: p.description }));
}

const oneOrMany = (x: string | string[]): YamlValue => (Array.isArray(x) ? [...x] : x);

export function graphFile(g: SuiteGraph): string {
  return toYaml({
    roles: Object.fromEntries(Object.entries(g.roles).map(([k, r]) => [k, omitEmpty({ name: r.name, surface: r.surface, usually: r.usually })])),
    screens: Object.fromEntries(Object.entries(g.screens).map(([k, list]) => [k, [...list]])),
    facts: { ...g.facts },
    starts: Object.fromEntries(Object.entries(g.starts).map(([k, st]) => [k, { say: st.say, at: { ...st.at } }])),
    actions: g.actions.map((a) => omitEmpty({
      device: oneOrMany(a.device),
      from: oneOrMany(a.from),
      to: a.to,
      do: a.do,
      needs: a.needs ? [...a.needs] : undefined,
      sets: a.sets ? [...a.sets] : undefined,
    })),
  });
}

/** Every file the suite is made of, by path relative to the root. */
export function suiteFiles(suite: Suite): Map<string, string> {
  const files = new Map<string, string>();
  files.set("product.yaml", productFile(suite.product));
  if (suite.graph) files.set("graph.yaml", graphFile(suite.graph));
  for (const t of suite.tests) files.set(`tests/${t.key}.yaml`, testFile(t));
  for (const tpl of suite.templates) {
    files.set(`templates/${tpl.key}/template.yaml`, templateFile(tpl));
    for (const f of tpl.flows) files.set(`templates/${tpl.key}/${f.key}.flow.yaml`, flowFile(f));
  }
  return files;
}

/**
 * Make the folder hold exactly `suite`. Files the suite no longer has are
 * removed — only suite files: anything else in the folder is left alone.
 * Returns what changed, by path.
 */
export async function writeFolder(root: string, suite: Suite) {
  const want = suiteFiles(suite);
  const have = await listSuiteFiles(root);
  const written: string[] = [];
  const removed: string[] = [];
  for (const [path, text] of want) {
    const full = join(root, path);
    const current = existsSync(full) ? await readFile(full, "utf8") : undefined;
    if (current === text) continue;
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text);
    written.push(path);
  }
  for (const path of have) {
    if (want.has(path)) continue;
    await rm(join(root, path));
    removed.push(path);
  }
  // Template folders left empty go too.
  if (existsSync(join(root, "templates"))) {
    for (const d of await readdir(join(root, "templates"), { withFileTypes: true })) {
      if (d.isDirectory() && !(await readdir(join(root, "templates", d.name))).length) await rm(join(root, "templates", d.name), { recursive: true });
    }
  }
  return { written, removed };
}

/**
 * Make one template's folder hold exactly `tpl`, leaving every other file
 * alone. Returns what changed, by path.
 */
export async function writeTemplateFolder(root: string, tpl: SuiteTemplate) {
  const dir = `templates/${tpl.key}`;
  const want = new Map([[`${dir}/template.yaml`, templateFile(tpl)], ...tpl.flows.map((f) => [`${dir}/${f.key}.flow.yaml`, flowFile(f)] as [string, string])]);
  const written: string[] = [];
  const removed: string[] = [];
  for (const [path, text] of want) {
    const full = join(root, path);
    if (existsSync(full) && (await readFile(full, "utf8")) === text) continue;
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text);
    written.push(path);
  }
  for (const path of (await listSuiteFiles(root)).filter((p) => p.startsWith(`${dir}/`))) {
    if (want.has(path)) continue;
    await rm(join(root, path));
    removed.push(path);
  }
  return { written, removed };
}

/** The suite files present under `root`, relative paths. */
export async function listSuiteFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  if (existsSync(join(root, "product.yaml"))) out.push("product.yaml");
  if (existsSync(join(root, "graph.yaml"))) out.push("graph.yaml");
  if (existsSync(join(root, "tests"))) {
    for (const f of await readdir(join(root, "tests"))) if (f.endsWith(".yaml")) out.push(`tests/${f}`);
  }
  if (existsSync(join(root, "templates"))) {
    for (const d of await readdir(join(root, "templates"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of await readdir(join(root, "templates", d.name))) {
        if (f === "template.yaml" || f.endsWith(".flow.yaml")) out.push(`templates/${d.name}/${f}`);
      }
    }
  }
  return out.sort();
}

/* ── Reading ──────────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;

class FileReader {
  problems: FileProblem[] = [];
  constructor(private root: string) {}

  error(file: string, message: string) { this.problems.push({ level: "error", file, message }); }
  warn(file: string, message: string) { this.problems.push({ level: "warning", file, message }); }

  async load(file: string): Promise<Obj | undefined> {
    let text: string;
    try { text = await readFile(join(this.root, file), "utf8"); } catch { this.error(file, "cannot be read"); return undefined; }
    let doc: unknown;
    try { doc = Bun.YAML.parse(text); } catch (e) { this.error(file, `is not valid YAML: ${(e as Error).message}`); return undefined; }
    if (doc === null || doc === undefined) return {};
    if (typeof doc !== "object" || Array.isArray(doc)) { this.error(file, "should be a map of fields (name: …), not a list or a value"); return undefined; }
    return doc as Obj;
  }

  /** Unknown fields are almost always typos (`expected:`, `devices:`); say so rather than drop them silently. */
  only(file: string, o: Obj, allowed: string[], where = "") {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.error(file, `${where}unknown field "${k}" (expected one of: ${allowed.join(", ")})`);
    }
  }

  string(file: string, o: Obj, key: string, where = "", required = false): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.error(file, `${where}needs "${key}"`);
      return undefined;
    }
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v !== "string") { this.error(file, `${where}"${key}" should be text`); return undefined; }
    return v.replace(/\n$/, "");
  }

  strings(file: string, o: Obj, key: string, where = ""): string[] | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") return [v];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) { this.error(file, `${where}"${key}" should be a list of keys`); return undefined; }
    return v as string[];
  }

  bool(file: string, o: Obj, key: string): boolean | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") { this.error(file, `"${key}" should be true or false`); return undefined; }
    return v;
  }
}

const keyOfFile = (name: string, suffix: string) => name.slice(0, -suffix.length);

/**
 * Read the folder into a suite. File-level problems (bad YAML, unknown fields,
 * a flow listed in template.yaml with no file) come back beside it; the suite's
 * own rules are `lintSuite`'s job.
 */
export async function readFolder(root: string): Promise<{ suite: Suite; problems: FileProblem[] }> {
  const r = new FileReader(root);

  const p = (await r.load("product.yaml")) ?? {};
  r.only("product.yaml", p, ["name", "description"]);
  const product = { name: r.string("product.yaml", p, "name", "", true) ?? "", ...(r.string("product.yaml", p, "description") ? { description: r.string("product.yaml", p, "description")! } : {}) };

  const tests: SuiteTest[] = [];
  const files = await listSuiteFiles(root);
  for (const file of files.filter((f) => f.startsWith("tests/"))) {
    const o = await r.load(file);
    if (!o) continue;
    r.only(file, o, ["title", "expect", "tags", "given", "metadata", "archived"]);
    const tags = r.strings(file, o, "tags");
    const given = o.given === undefined || o.given === null ? undefined : readGiven(r, file, o.given);
    const metadata = o.metadata;
    if (metadata !== undefined && (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))) r.error(file, `"metadata" should be a map`);
    const archived = r.bool(file, o, "archived");
    tests.push({
      key: keyOfFile(file.slice("tests/".length), ".yaml"),
      title: r.string(file, o, "title", "", true) ?? "",
      expect: r.string(file, o, "expect", "", true) ?? "",
      ...(tags?.length ? { tags } : {}),
      ...(given ? { given } : {}),
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata).length ? { metadata: metadata as Record<string, unknown> } : {}),
      ...(archived ? { archived } : {}),
    });
  }

  const templates: SuiteTemplate[] = [];
  const templateDirs = [...new Set(files.filter((f) => f.startsWith("templates/")).map((f) => f.split("/")[1]!))].sort();
  for (const dir of templateDirs) {
    const tfile = `templates/${dir}/template.yaml`;
    const flowFiles = files.filter((f) => f.startsWith(`templates/${dir}/`) && f.endsWith(".flow.yaml"));
    if (!files.includes(tfile)) { r.error(tfile, `is missing: the folder templates/${dir} has flows but no template.yaml`); continue; }
    const o = (await r.load(tfile)) ?? {};
    r.only(tfile, o, ["name", "description", "archived", "flows"]);
    const order = r.strings(tfile, o, "flows") ?? [];
    const present = new Map(flowFiles.map((f) => [keyOfFile(f.split("/")[2]!, ".flow.yaml"), f]));
    const keys = [...order];
    for (const k of order) if (!present.has(k)) r.error(tfile, `lists flow "${k}", but templates/${dir}/${k}.flow.yaml does not exist`);
    for (const k of [...present.keys()].sort()) {
      if (!order.includes(k)) {
        r.warn(tfile, `does not list flow "${k}"; it goes last. Add it to "flows:" to place it`);
        keys.push(k);
      }
    }
    const flows: SuiteFlow[] = [];
    for (const k of keys) {
      const file = present.get(k);
      if (!file) continue;
      const flow = await readFlow(r, file, k);
      if (flow) flows.push(flow);
    }
    const description = r.string(tfile, o, "description");
    const archived = r.bool(tfile, o, "archived");
    templates.push({
      key: dir,
      name: r.string(tfile, o, "name", "", true) ?? "",
      ...(description ? { description } : {}),
      ...(archived ? { archived } : {}),
      flows,
    });
  }

  const graph = files.includes("graph.yaml") ? await readGraph(r, "graph.yaml") : undefined;

  return { suite: { product, tests, templates, ...(graph ? { graph } : {}) }, problems: r.problems };
}

const isMap = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** A comma inside `{ }` ends the value, which turns the rest of it into a field nobody meant: say so with every unknown field. */
const COMMA_HINT = ` — a comma inside { } ends a value: quote it`;

function readGiven(r: FileReader, file: string, v: unknown): TestGiven | undefined {
  if (!isMap(v)) { r.error(file, `"given" should be a map (device: …, at: …)`); return undefined; }
  const where = "given: ";
  for (const k of Object.keys(v)) if (!["device", "at", "facts", "also", "look"].includes(k)) r.error(file, `${where}unknown field "${k}" (expected one of: device, at, facts, also, look)${COMMA_HINT}`);
  const device = r.string(file, v, "device", where, true);
  const at = r.string(file, v, "at", where, true);
  const facts = r.strings(file, v, "facts", where);
  const look = r.string(file, v, "look", where);
  let also: Record<string, string> | undefined;
  if (v.also !== undefined && v.also !== null) {
    if (!isMap(v.also) || !Object.values(v.also).every((x) => typeof x === "string")) r.error(file, `${where}"also" should be a map of role: screen`);
    else also = v.also as Record<string, string>;
  }
  if (!device || !at) return undefined;
  return { device, at, ...(facts?.length ? { facts } : {}), ...(also && Object.keys(also).length ? { also } : {}), ...(look ? { look } : {}) };
}

async function readGraph(r: FileReader, file: string): Promise<SuiteGraph | undefined> {
  const o = await r.load(file);
  if (!o) return undefined;
  r.only(file, o, ["roles", "screens", "facts", "starts", "actions"]);
  const mapOf = (key: string): Obj => {
    const v = o[key] ?? {};
    if (!isMap(v)) { r.error(file, `"${key}" should be a map`); return {}; }
    return v;
  };

  const roles: SuiteGraph["roles"] = {};
  for (const [k, v] of Object.entries(mapOf("roles"))) {
    const where = `role ${k}: `;
    if (!isMap(v)) { r.error(file, `${where}should be a map (name: …, surface: …)`); continue; }
    for (const f of Object.keys(v)) if (!["name", "surface", "usually"].includes(f)) r.error(file, `${where}unknown field "${f}" (expected one of: name, surface, usually)${COMMA_HINT}`);
    const usually = r.string(file, v, "usually", where);
    roles[k] = { name: r.string(file, v, "name", where, true) ?? "", surface: r.string(file, v, "surface", where, true) ?? "", ...(usually ? { usually } : {}) };
  }

  const screens: SuiteGraph["screens"] = {};
  for (const [k, v] of Object.entries(mapOf("screens"))) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) { r.error(file, `screens ${k}: should be a list of screen names`); continue; }
    screens[k] = v as string[];
  }

  const facts: SuiteGraph["facts"] = {};
  for (const [k, v] of Object.entries(mapOf("facts"))) {
    if (typeof v !== "string") { r.error(file, `fact ${k}: should be a sentence saying what it means`); continue; }
    facts[k] = v;
  }

  const starts: SuiteGraph["starts"] = {};
  for (const [k, v] of Object.entries(mapOf("starts"))) {
    const where = `start ${k}: `;
    if (!isMap(v)) { r.error(file, `${where}should be a map (say: …, at: …)`); continue; }
    for (const f of Object.keys(v)) if (!["say", "at"].includes(f)) r.error(file, `${where}unknown field "${f}" (expected one of: say, at)${COMMA_HINT}`);
    if (!isMap(v.at) || !Object.values(v.at).every((x) => typeof x === "string")) { r.error(file, `${where}"at" should be a map of role: screen`); continue; }
    starts[k] = { say: r.string(file, v, "say", where, true) ?? "", at: v.at as Record<string, string> };
  }

  const actions: GraphAction[] = [];
  const raw = o.actions ?? [];
  if (!Array.isArray(raw)) r.error(file, `"actions" should be a list`);
  else raw.forEach((a, i) => {
    const where = `action ${i + 1}: `;
    if (!isMap(a)) { r.error(file, `${where}should be a map (device: …, from: …, do: …)`); return; }
    for (const f of Object.keys(a)) if (!["device", "from", "to", "do", "needs", "sets"].includes(f)) r.error(file, `${where}unknown field "${f}" (expected one of: device, from, to, do, needs, sets)${COMMA_HINT}`);
    const oneOrMore = (key: string) => {
      const v = a[key];
      if (typeof v === "string") return v;
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) return v as string[];
      r.error(file, `${where}needs "${key}": a name, or a list of them`);
      return undefined;
    };
    const device = oneOrMore("device"), from = oneOrMore("from");
    const to = r.string(file, a, "to", where);
    const text = r.string(file, a, "do", where, true);
    const needs = r.strings(file, a, "needs", where), sets = r.strings(file, a, "sets", where);
    if (!device || !from || !text) return;
    actions.push({ device, from, ...(to ? { to } : {}), do: text, ...(needs?.length ? { needs } : {}), ...(sets?.length ? { sets } : {}) });
  });

  return { roles, screens, facts, starts, actions };
}

async function readFlow(r: FileReader, file: string, key: string): Promise<SuiteFlow | undefined> {
  const o = await r.load(file);
  if (!o) return undefined;
  r.only(file, o, ["name", "precondition", "estimateMinutes", "archived", "steps"]);
  const raw = o.steps ?? [];
  if (!Array.isArray(raw)) { r.error(file, `"steps" should be a list`); return undefined; }
  const steps: SuiteStep[] = [];
  raw.forEach((s, i) => {
    const where = `step ${i + 1}: `;
    if (!s || typeof s !== "object" || Array.isArray(s)) { r.error(file, `${where}should be a map (do: … / check: …, device: …)`); return; }
    const so = s as Obj;
    r.only(file, so, ["do", "check", "device", "expect", "after", "verifies"], where);
    const hasDo = "do" in so, hasCheck = "check" in so;
    if (hasDo === hasCheck) { r.error(file, `${where}needs exactly one of "do:" (something to do) or "check:" (something to look at)`); return; }
    const kind = hasCheck ? "check" : "action";
    const text = r.string(file, so, hasCheck ? "check" : "do", where, true) ?? "";
    const device = r.string(file, so, "device", where, true) ?? "";
    const expect = r.string(file, so, "expect", where);
    const after = r.string(file, so, "after", where);
    const verifies = r.strings(file, so, "verifies", where);
    steps.push({
      kind, text, device,
      ...(expect ? { expect } : {}),
      ...(after ? { after } : {}),
      ...(verifies?.length ? { verifies } : {}),
    });
  });
  const est = o.estimateMinutes;
  if (est !== undefined && est !== null && typeof est !== "number") r.error(file, `"estimateMinutes" should be a number`);
  const precondition = r.string(file, o, "precondition");
  const archived = r.bool(file, o, "archived");
  return {
    key,
    name: r.string(file, o, "name", "", true) ?? "",
    ...(precondition ? { precondition } : {}),
    ...(typeof est === "number" ? { estimateMinutes: est } : {}),
    ...(archived ? { archived } : {}),
    steps,
  };
}

/* ── Where a suite path lives ─────────────────────────────────────────── */

/**
 * `["templates", 0, "flows", 2, "steps", 5, "text"]` → `templates/regression/messaging.flow.yaml step 6`.
 * Lint speaks in paths into the document; a person wants the file and the step.
 */
export function locate(suite: Suite, path: readonly (string | number)[]): string {
  const [top, i, , fi, , si] = path;
  if (top === "product") return "product.yaml";
  if (top === "graph") {
    const [, section, at] = path;
    if (section === "actions" && typeof at === "number") return `graph.yaml action ${at + 1}`;
    return at === undefined ? "graph.yaml" : `graph.yaml ${section} ${at}`;
  }
  if (top === "tests" && typeof i === "number") return `tests/${suite.tests[i]?.key ?? i}.yaml`;
  if (top === "templates" && typeof i === "number") {
    const tpl = suite.templates[i];
    const dir = `templates/${tpl?.key ?? i}`;
    if (typeof fi !== "number") return `${dir}/template.yaml`;
    const file = `${dir}/${tpl?.flows[fi]?.key ?? fi}.flow.yaml`;
    return typeof si === "number" ? `${file} step ${si + 1}` : file;
  }
  return path.join(".");
}

export const rel = (root: string, p: string) => relative(process.cwd(), join(root, p)) || ".";
