import { drizzle } from "drizzle-orm/postgres-js";
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
