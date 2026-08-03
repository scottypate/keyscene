import { resolve } from "node:path";
import { defineConfig } from "vite";

// Tauri dev expects a fixed port (tauri.conf.json devUrl).
// Two pages: index.html (Studio, "main" window) and display.html
// (Display mode, "display" window).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    // A production crash in a webview is undebuggable without maps.
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        display: resolve(__dirname, "display.html"),
      },
      output: {
        // Keep the notation engine in its own honestly-named chunk.
        manualChunks: { vexflow: ["vexflow/bravura"] },
      },
    },
  },
});
