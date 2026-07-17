import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.BACKEND_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
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
