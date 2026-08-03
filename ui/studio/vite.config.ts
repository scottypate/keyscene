import { defineConfig } from "vite";

// Tauri dev expects a fixed port (tauri.conf.json devUrl).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
