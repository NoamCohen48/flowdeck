/**
 * Prepares the API tests' own database: creates `flowdeck_test` if it is missing,
 * migrates and seeds it fresh, and starts the Electric that follows it. Run once,
 * and again whenever you want a clean slate; `bun test` then never touches the
 * development data.
 *
 *   bun run test:setup
 */
import postgres from "postgres";
import { $ } from "bun";

const password = process.env.POSTGRES_PASSWORD || "flowdeck-dev";
const port = process.env.POSTGRES_PORT || "54321";
const base = `postgresql://flowdeck:${password}@localhost:${port}`;
const testUrl = `${base}/flowdeck_test`;

const admin = postgres(`${base}/postgres`, { max: 1 });
try {
  const [row] = await admin`select 1 from pg_database where datname = 'flowdeck_test'`;
  if (!row) {
    await admin.unsafe("create database flowdeck_test");
    console.log("created flowdeck_test");
  }
} finally {
  await admin.end();
}

const env = { ...process.env, DATABASE_URL: testUrl };
const here = import.meta.dir;
await $`bun ${here}/migrate.ts`.env(env);
await $`bun ${here}/seed.ts --reset`.env(env);
await $`docker compose --profile test up -d --wait electric-test`.cwd(`${here}/../../../..`);
console.log("ready: bun test now runs against flowdeck_test");
