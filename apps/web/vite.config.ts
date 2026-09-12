import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // One origin in development too: the API, the shape proxy and attachments
    // all live behind /api, exactly as Caddy fronts them in production.
    // API_URL points it at an API on another port (a second checkout, a busy 8787).
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: true },
});
