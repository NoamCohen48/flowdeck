/**
 * Writes the suite's YAML files. Reading is `Bun.YAML.parse`; writing is this,
 * because the files are read and diffed by people and agents: block style,
 * plain scalars wherever they are safe, short lists inline, long text as a
 * literal block, keys in the order they were given, no trailing spaces.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue | undefined };

/** Words a YAML 1.1 or 1.2 reader might take for something other than a string. */
const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;
const NUMBERISH = /^[-+]?(?:\.?\d|\.(?:inf|nan)$)|^0[xob]/i;

function isPlain(s: string, inFlow: boolean): boolean {
  if (!s || s !== s.trim() || s.includes("\n")) return false;
  if (RESERVED.test(s) || NUMBERISH.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return false;
  if (inFlow && /[,[\]{}]/.test(s)) return false;
  return true;
}

function scalar(v: string | number | boolean | null, inFlow = false): string {
  if (v === null) return "null";
  if (typeof v !== "string") return String(v);
  return isPlain(v, inFlow) ? v : JSON.stringify(v);
}

const isScalar = (v: unknown): v is string | number | boolean | null => v === null || ["string", "number", "boolean"].includes(typeof v);

/** A literal block keeps multi-line text readable — unless its first line starts with a space, which `|` cannot say plainly. */
function block(s: string, indent: string): string | undefined {
  if (!s.includes("\n") || /^[ \t]/.test(s) || /[ \t]$/m.test(s) || s.endsWith("\n\n")) return undefined;
  const chomp = s.endsWith("\n") ? "|" : "|-";
  const body = (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n").map((l) => (l ? `${indent}${l}` : "")).join("\n");
  return `${chomp}\n${body}`;
}

function inlineList(list: YamlValue[]): string | undefined {
  if (!list.every((x) => isScalar(x) && !(typeof x === "string" && x.includes("\n")))) return undefined;
  const out = `[${list.map((x) => scalar(x as string, true)).join(", ")}]`;
  return out.length <= 72 ? out : undefined;
}

function mapLines(map: { [key: string]: YamlValue | undefined }, indent: string): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    const k = scalar(key);
    if (isScalar(value)) {
      const b = typeof value === "string" ? block(value, `${indent}  `) : undefined;
      lines.push(`${indent}${k}: ${b ?? scalar(value)}`);
    } else if (Array.isArray(value)) {
      if (!value.length) lines.push(`${indent}${k}: []`);
      else {
        const inline = inlineList(value);
        if (inline) lines.push(`${indent}${k}: ${inline}`);
        else lines.push(`${indent}${k}:`, ...listLines(value, `${indent}  `));
      }
    } else if (!Object.keys(value).some((x) => value[x] !== undefined)) {
      lines.push(`${indent}${k}: {}`);
    } else {
      lines.push(`${indent}${k}:`, ...mapLines(value, `${indent}  `));
    }
  }
  return lines;
}

function listLines(list: YamlValue[], indent: string): string[] {
  const lines: string[] = [];
  for (const item of list) {
    if (isScalar(item)) {
      const b = typeof item === "string" ? block(item, `${indent}  `) : undefined;
      lines.push(`${indent}- ${b ?? scalar(item)}`);
    } else if (Array.isArray(item)) {
      const inner = item.length ? listLines(item, `${indent}  `) : [`${indent}  []`];
      lines.push(`${indent}-${inner[0]!.slice(indent.length + 1)}`, ...inner.slice(1));
    } else {
      const inner = mapLines(item, `${indent}  `);
      if (!inner.length) lines.push(`${indent}- {}`);
      else lines.push(`${indent}- ${inner[0]!.slice(indent.length + 2)}`, ...inner.slice(1));
    }
  }
  return lines;
}

/** A document whose top level is a map. */
export function toYaml(doc: { [key: string]: YamlValue | undefined }): string {
  return `${mapLines(doc, "").join("\n")}\n`;
}
