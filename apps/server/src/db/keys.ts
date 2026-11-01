/**
 * Readable keys: every product, test, template and flow has one, assigned at
 * creation from its name and unique in its scope. A key is how the CLI's files and
 * a suite document name things, so it never changes on its own — renaming a test
 * keeps its key. Only an explicit write (a suite push, a PATCH with `key`) moves it.
 */
import { sql as raw } from "drizzle-orm";
import { KEY_PATTERN, slugify, uniqueKey } from "@flowdeck/domain";
import { db } from "./client.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = Tx | typeof db;

export type KeyScope =
  | { table: "product" }
  | { table: "test" | "template"; productId: string }
  | { table: "flow"; templateId: string };

/** A caller asked for a key that something else in the scope already has. */
export class KeyTakenError extends Error {
  constructor(readonly key: string) {
    super(`the key "${key}" is taken`);
  }
}

/** A caller asked for something that is not a key. */
export class BadKeyError extends Error {
  constructor(readonly key: string) {
    super(`"${key}" is not a key: use lowercase letters, digits and single hyphens`);
  }
}

async function taken(conn: Conn, scope: KeyScope, base: string): Promise<Set<string>> {
  const like = `${base.replace(/[\\%_]/g, "\\$&")}-%`;
  const column = scope.table === "product" ? raw`slug` : raw`key`;
  const where =
    scope.table === "product" ? raw`true`
    : scope.table === "flow" ? raw`template_id = ${scope.templateId}`
    : raw`product_id = ${scope.productId}`;
  const rows = (await conn.execute(
    raw`select ${column} as key from ${raw.raw(scope.table)} where ${where} and (${column} = ${base} or ${column} like ${like})`,
  )) as unknown as { key: string }[];
  return new Set(rows.map((r) => r.key));
}

/**
 * The key a new row gets: `wanted` exactly when given (or an error saying why
 * not), otherwise one made from `name`, with `-2`, `-3`… when that is taken.
 */
export async function assignKey(conn: Conn, scope: KeyScope, name: string, wanted?: string | null): Promise<string> {
  if (wanted) {
    if (!KEY_PATTERN.test(wanted)) throw new BadKeyError(wanted);
    if ((await taken(conn, scope, wanted)).has(wanted)) throw new KeyTakenError(wanted);
    return wanted;
  }
  const base = slugify(name, scope.table);
  return uniqueKey(base, await taken(conn, scope, base));
}
