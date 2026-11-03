/**
 * What `status` and `pull` need from a pulled base: what you changed locally, and
 * a three-way merge of your folder with the server's suite.
 *
 * The merge works on whole things — a test, a flow, a template's own fields and
 * flow order, the product, the graph — not lines. A thing only you changed keeps your
 * version; a thing only the server changed takes the server's; a thing both
 * changed differently keeps yours and is reported, so a push afterwards says
 * plainly that it overwrites the other edit.
 */
import { metadataOf, planSuite, type Stored, type Suite, type SuiteFlow, type SuiteGraph, type SuiteTemplate, type SuiteTest } from "@flowdeck/domain";

/** A suite as `planSuite`'s stored side, with keys standing in for ids. */
export function asStored(s: Suite): Stored {
  return {
    product: { name: s.product.name, description: s.product.description ?? "", graph: s.graph ?? null },
    tests: s.tests.map((t) => ({
      id: t.key, key: t.key, title: t.title, expect: t.expect, archived: t.archived ?? false,
      metadata: metadataOf(t),
    })),
    templates: s.templates.map((t) => ({
      id: t.key, key: t.key, name: t.name, description: t.description ?? "", archived: t.archived ?? false,
      flows: t.flows.map((f) => ({
        id: `${t.key}/${f.key}`, key: f.key, name: f.name, precondition: f.precondition ?? "", estimateMinutes: f.estimateMinutes ?? null, archived: f.archived ?? false,
        steps: f.steps.map((st, i) => ({
          id: `${t.key}/${f.key}#${i}`, kind: st.kind, text: st.text, device: st.device,
          expect: st.expect ?? null, after: st.after ?? null, verifies: [...(st.verifies ?? [])],
        })),
      })),
    })),
  };
}

/** What a push of `local` would change, judged against `base` alone — offline. */
export function localChanges(base: Suite, local: Suite) {
  return planSuite(asStored(base), local).changes;
}

type Entity =
  | { kind: "product"; value: Suite["product"] }
  | { kind: "graph"; value: SuiteGraph }
  | { kind: "test"; value: SuiteTest }
  | { kind: "template"; value: Omit<SuiteTemplate, "flows"> & { order: string[] } }
  | { kind: "flow"; template: string; value: SuiteFlow };

function entities(s: Suite): Map<string, Entity> {
  const m = new Map<string, Entity>();
  m.set("product", { kind: "product", value: s.product });
  if (s.graph) m.set("graph", { kind: "graph", value: s.graph });
  for (const t of s.tests) m.set(`test ${t.key}`, { kind: "test", value: t });
  for (const t of s.templates) {
    const { flows, ...meta } = t;
    m.set(`template ${t.key}`, { kind: "template", value: { ...meta, order: flows.map((f) => f.key) } });
    for (const f of flows) m.set(`flow ${t.key}/${f.key}`, { kind: "flow", template: t.key, value: f });
  }
  return m;
}

const same = (a: Entity | undefined, b: Entity | undefined) => JSON.stringify(a?.value) === JSON.stringify(b?.value);

export interface Merged {
  suite: Suite;
  /** Things the server changed that were taken. */
  taken: string[];
  /** Things you changed that were kept. */
  kept: string[];
  /** Changed on both sides, differently: yours kept. */
  conflicts: string[];
}

export function merge(base: Suite, local: Suite, remote: Suite): Merged {
  const b = entities(base), l = entities(local), r = entities(remote);
  const out = new Map<string, Entity>();
  const taken: string[] = [], kept: string[] = [], conflicts: string[] = [];
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const [eb, el, er] = [b.get(id), l.get(id), r.get(id)];
    let pick: Entity | undefined;
    if (same(el, eb)) { pick = er; if (!same(er, eb)) taken.push(id); }
    else if (same(er, eb) || same(el, er)) { pick = el; kept.push(id); }
    else { pick = el; conflicts.push(id); }
    if (pick) out.set(id, pick);
  }

  const product = (out.get("product") as Extract<Entity, { kind: "product" }> | undefined)?.value ?? remote.product;
  const tests = [...out.values()].filter((e): e is Extract<Entity, { kind: "test" }> => e.kind === "test").map((e) => e.value).sort((x, y) => x.key.localeCompare(y.key));
  const flowsOf = (tpl: string) => [...out.values()].filter((e): e is Extract<Entity, { kind: "flow" }> => e.kind === "flow" && e.template === tpl).map((e) => e.value);
  const templates = [...out.values()]
    .filter((e): e is Extract<Entity, { kind: "template" }> => e.kind === "template")
    .map((e) => {
      const { order, ...meta } = e.value;
      const flows = flowsOf(meta.key);
      const ordered = [...order.map((k) => flows.find((f) => f.key === k)).filter((f): f is SuiteFlow => !!f), ...flows.filter((f) => !order.includes(f.key))];
      return { ...meta, flows: ordered };
    })
    .sort((x, y) => x.key.localeCompare(y.key));

  const graph = (out.get("graph") as Extract<Entity, { kind: "graph" }> | undefined)?.value;
  return { suite: { product, tests, templates, ...(graph ? { graph } : {}) }, taken, kept, conflicts };
}
