import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.ts";

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://flowdeck:flowdeck-dev@localhost:54321/flowdeck";

/** One pool for the process. Migrations open their own single connection. */
export const sql = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(sql, { schema });
export { schema };
export type Db = typeof db;

/**
 * Run a raw SQL query and get typed rows back as a real Promise.
 *
 * `db.execute()` returns a lazy builder that does nothing until awaited — which
 * has twice now produced code that looked like it wrote a row and did not. This
 * wrapper always executes, and carries the row type so call sites stop needing
 * `as unknown as T[]`.
 */
export async function query<T extends object>(
  statement: SQL,
): Promise<T[]> {
  const result = await db.execute(statement);
  return result as unknown as T[];
}
