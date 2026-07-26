import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Loopback IP + fixed port so the redirect URI is stable and matches Spotify's
// rules (localhost is banned; 127.0.0.1 over http is allowed for local dev).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
