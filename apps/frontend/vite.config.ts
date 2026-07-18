import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.BACKEND_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
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
