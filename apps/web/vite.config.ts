import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // One origin in development too: the API, the shape proxy and attachments
    // all live behind /api, exactly as Caddy fronts them in production.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: true },
});
