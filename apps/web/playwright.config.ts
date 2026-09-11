import { defineConfig } from "@playwright/test";

/**
 * Multi-context end-to-end: two browsers, one testing day. Runs against the
 * dev servers and the compose database, the same way a person would.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5173", viewport: { width: 1280, height: 900 } },
  webServer: [
    {
      command: "bun src/index.ts",
      cwd: "../server",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      env: { ATTACHMENTS_DIR: "/tmp/flowdeck-e2e-attachments" },
    },
    {
      command: "bun run dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
