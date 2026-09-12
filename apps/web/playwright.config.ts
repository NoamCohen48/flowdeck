import { defineConfig } from "@playwright/test";

/**
 * Multi-context end-to-end: two browsers, one testing day. Runs against the
 * dev servers and the compose database, the same way a person would.
 */
// API_PORT / WEB_PORT move both servers when the defaults are taken on this machine.
const apiPort = Number(process.env.API_PORT ?? 8787);
const webPort = Number(process.env.WEB_PORT ?? 5173);

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
      env: { PORT: String(apiPort), ATTACHMENTS_DIR: "/tmp/flowdeck-e2e-attachments" },
    },
    {
      command: `bunx vite --port ${webPort} --strictPort`,
      port: webPort,
      reuseExistingServer: !process.env.CI,
      env: { API_URL: `http://localhost:${apiPort}` },
    },
  ],
});
