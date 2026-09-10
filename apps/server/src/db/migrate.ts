/**
 * Applies the generated Drizzle migrations, then the hand-written derived state
 * (`sql/derived.sql`) which Drizzle does not model: the coverage view, the
 * verdict-rank function, and the replica identities Electric needs.
 *
 * `derived.sql` is idempotent — every statement is CREATE OR REPLACE or an
 * ALTER that can be re-run — so it is applied on every migrate rather than
 * being versioned. That keeps the view definition in one readable file instead
 * of scattered across migration diffs.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { DATABASE_URL } from "./client.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const derivedPath = fileURLToPath(new URL("./sql/derived.sql", import.meta.url));

const connection = postgres(DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(connection), { migrationsFolder });
  console.log("migrations applied");

  await connection.unsafe(await readFile(derivedPath, "utf8"));
  console.log("derived state applied (coverage view, verdict_rank, replica identity)");
} finally {
  await connection.end();
}
