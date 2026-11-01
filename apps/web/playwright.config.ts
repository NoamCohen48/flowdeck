import { defineConfig } from "@playwright/test";

/**
 * Multi-context end-to-end: two browsers, one testing day. Runs against the
 * dev servers and the compose database, the same way a person would.
 */
// Ports of their own, so a run never reuses the dev servers (and their database)
// on 8787/5173. API_PORT / WEB_PORT move them when these are taken too.
const apiPort = Number(process.env.API_PORT ?? 8788);
const webPort = Number(process.env.WEB_PORT ?? 5174);
// The tests start testing days and record verdicts, so by default they get the
// test database and its Electric (`bun run test:setup`), never the dev data.
// An explicit DATABASE_URL — CI's — wins.
const testDb: Record<string, string> = process.env.DATABASE_URL
  ? {}
  : { DATABASE_URL: "postgresql://flowdeck:flowdeck-dev@localhost:54321/flowdeck_test", ELECTRIC_URL: "http://localhost:3011" };

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${webPort}`, viewport: { width: 1280, height: 900 } },
  webServer: [
    {
      command: "bun src/index.ts",
      cwd: "../server",
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(apiPort), ATTACHMENTS_DIR: "/tmp/flowdeck-e2e-attachments", ...testDb },
    },
    {
      command: `bunx vite --port ${webPort} --strictPort`,
      port: webPort,
      reuseExistingServer: !process.env.CI,
      env: { API_URL: `http://localhost:${apiPort}` },
    },
  ],
});
