import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.BACKEND_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  // Baked in at image build time by the release workflow (BREWHUB_VERSION
  // build-arg), so the UI can tell which interface build is loaded.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.BREWHUB_VERSION ?? "dev"),
  },
  // No frontend test files exist yet (see CLAUDE.md §0.6 — testing focuses
  // on the control-loop firmware and backend logic, not the frontend) —
  // without this, `vitest run` exits 1 on "no test files found", which
  // breaks `pnpm -r test` for the whole monorepo, not just this package.
  test: {
    passWithNoTests: true,
  },
  server: {
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/ws": {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
});
